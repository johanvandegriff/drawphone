/*
 *  Drawphone Game Logic
 *  By Tanner Krewson
 */

function Drawphone() {
  this.games = [];

  //add the dev game
  this.newGame('ffff');
}

Drawphone.prototype.newGame = function(forceCode) {

  var newCode;
  if (forceCode) {
    newCode = forceCode;
  } else {
    newCode = this.generateCode();
  }

  var self = this;
  var newGame = new Game(newCode, function() {
    //will be ran when this game has 0 players left
    self.removeGame(newCode);
  });
  this.games.push(newGame);
  console.log(newCode + ' created');
  return newGame;
}

Drawphone.prototype.findGame = function(code) {
  for (var i = 0; i < this.games.length; i++) {
    if (this.games[i].code === code.toLowerCase()) {
      return this.games[i];
    }
  }
  return false;
}

Drawphone.prototype.generateCode = function() {
  var code;
  do {
    //generate 6 letter code
    code = "";
    var possible = "abcdefghijklmnopqrstuvwxyz";
    for(var i=0; i < 4; i++ ) {
      code += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    //make sure the code is not already in use
  } while (this.findGame(code));
  return code;
}

Drawphone.prototype.removeGame = function(code) {
  var game = this.findGame(code);

  var index = this.games.indexOf(game);
  if (index > -1) {
      this.games.splice(index, 1);
      console.log(code + ' removed');
  }
}


function Game(code, onEmpty) {
  this.code = code;
  this.onEmpty = onEmpty;
  this.players = [];
  this.inProgress = false;
  this.currentRound;

  this.currentId = 1;
  this.currentRoundNum = 1;
}

Game.prototype.addPlayer = function(name, socket) {
  var newPlayer = new Player(name, socket, this.getNextId());
  this.players.push(newPlayer);

  this.sendUpdatedPlayersList();

  //when this player disconnects, remove them from this game
  var self = this;
  socket.on('disconnect', function() {
    self.removePlayer(newPlayer.id);
    self.sendUpdatedPlayersList();
  });

  return newPlayer;
}

Game.prototype.removePlayer = function(id) {
  var player = this.getPlayer(id);

  var index = this.players.indexOf(player);
  if (index > -1) {
      this.players.splice(index, 1);
  }

  //if there are no players left
  if (this.players.length === 0) {
    this.onEmpty();
  }
}

Game.prototype.getPlayer = function(id) {
  for (var i = 0; i < this.players.length; i++) {
    if (this.players[i].id === id) {
      return this.players[i];
    }
  }
  return false;
}

Game.prototype.getNextId = function() {
  return this.currentId++;
}

Game.prototype.getNextRoundNum = function() {
  return this.currentRoundNum++;
}

Game.prototype.getJsonGame = function () {
  var players = [];
  this.players.forEach(function(player) {
    players.push(player.getJson());
  });

  var jsonGame = {
    code: this.code,
    players,
    inProgress: this.inProgress
  };
  return jsonGame;
};

Game.prototype.sendUpdatedPlayersList = function() {
  this.sendToAll('updatePlayerList', this.getJsonGame().players);
}

Game.prototype.sendToAll = function(event, data) {
  this.players.forEach(function(player) {
    player.socket.emit(event, data);
  });
}

Game.prototype.startNewRound = function() {
  this.inProgress = true;

  var self = this;
  this.currentRound = new Round(this.getNextRoundNum(), this.players, function() {
    self.inProgress = false;
  });

  this.currentRound.start();
}


function Round(number, players, onEnd) {
  this.number = number;
  this.players = players;
  this.onEnd = onEnd;
  this.chains = [];

  this.finalNumOfLinks;
}

Round.prototype.start = function() {
  //each player will have to complete one link for how many players there are
  //  the final number of links each chain should have at the end of this
  //  round is number of players + 1, because each chain has an extra link
  //  for the original word
  this.finalNumOfLinks = this.players.length + 1;

  var currentChainId = 0;
  var self = this;
  this.players.forEach(function(player) {
    //give each player a chain of their own
    var thisChain = new Chain('apple' + player.id, player, currentChainId++);
    self.chains.push(thisChain);
    player.sendLink(thisChain.getLastLink(), thisChain.id, function(player, link, chainId) {
      self.receiveLink(player, link, chainId);
    });
  });
}

Round.prototype.receiveLink = function(player, receivedLink, chainId) {
  var chain = this.getChain(chainId);

  if (receivedLink.type === 'drawing') {
    chain.addLink(new DrawingLink(player, receivedLink.data));
  } else {
    chain.addLink(new WordLink(player, receivedLink.data));
  }

  this.nextLinkIfEveryoneIsDone();
}

Round.prototype.nextLinkIfEveryoneIsDone = function() {
  //check to make sure every chain is the same length
  var readyToMoveOn = true;
  for (var i = 0; i < this.chains.length - 1; i++) {
    if (this.chains[i].getLength() !== this.chains[i+1].getLength()) {
      readyToMoveOn = false;
      break;
    }
  }

  if (readyToMoveOn) {
    //check if that was the last link
    //  we check 0, but any index should work, because they are all the same,
    //  as checked above
    if (this.chains[0].getLength() === this.finalNumOfLinks) {
      this.end();
    } else {
      this.startNextLink();
    }
  }
}

Round.prototype.startNextLink = function() {
  var remainingChainsToDelegate = this.chains.slice();

  var self = this;
  this.players.forEach(function(player) {
    var chainToTry;

    //do until we have a chain that the player has not already played in
    do {
      chainToTry = Round.getRandomChain(remainingChainsToDelegate);
    } while (chainToTry.playerHasLink(player));

    //remove chain from our temporary array so that it is not assigned again
    var chainIndex = remainingChainsToDelegate.indexOf(chainToTry);
    remainingChainsToDelegate.splice(chainIndex, 1);

    //send the player the last link from the chain
    player.sendLink(chainToTry.getLastLink(), chainToTry.id, function(player, link, chainId) {
      self.receiveLink(player, link, chainId);
    });
  });

}

Round.prototype.getChain = function(id) {
  for (var i = 0; i < this.chains.length; i++) {
    if (this.chains[i].id === id) {
      return this.chains[i];
    }
  }
  return false;
}

Round.getRandomChain = function(chainList) {
  return chainList[Math.floor(Math.random()*chainList.length)];
}

Round.prototype.end = function() {
  this.onEnd();
  this.players.forEach(function(player) {
    player.sendRoundOver();
  });
}

Round.prototype.someoneLeft = function(name) {
  this.onEnd();
  this.players.forEach(function(player) {
    player.sendSomeoneLeft(name);
  });
}


// A chain is the 'chain' of drawings and words.
// A link is the individual drawing or word in the chain.
function Chain(firstWord, owner, id) {
  this.owner = owner;
  this.links = [];
  this.id = id;

  this.addLink(new WordLink(this.owner, firstWord));
}

Chain.prototype.addLink = function(link) {
  this.links.push(link);
}

Chain.prototype.getLastLink = function() {
  return this.links[this.links.length - 1];
}

Chain.prototype.getLength = function() {
  return this.links.length;
}

//returns true if the player has a link in this chain already
Chain.prototype.playerHasLink = function(player) {
  for (var i = 0; i < this.links.length; i++) {
    if (this.links[i].player.id === player.id) {
      return true;
    }
  }
  return false;
}


function DrawingLink(player, drawing) {
  Link.call(this, player, drawing);
  this.type = 'drawing';
}
DrawingLink.prototype = Object.create(Link.prototype);


function WordLink(player, word) {
  Link.call(this, player, word);
  this.type = 'word';
}
WordLink.prototype = Object.create(Link.prototype);


function Link(player, data) {
  this.player = player.getJson();
  this.data = data;
}


function Player(name, socket, id) {
  this.name = name;
  this.socket = socket;
  this.id = id;
}

Player.prototype.getJson = function() {
  return newPlayer = {
    name: this.name,
    id: this.id
  }
}

Player.prototype.sendLink = function(link, chainId, next) {
  this.socket.emit('nextLink', {
    link,
    chainId
  });

  //when we get the link back from this Player
  var self = this;
  this.socket.once('finishedLink', function(data) {
    next(self, data.link, chainId);
  });
}

Player.prototype.sendRoundOver = function() {
  this.socket.emit('roundOver', {});
}

Player.prototype.sendSomeoneLeft = function(name) {
  this.socket.emit('someoneLeft', {
    name
  });
}


module.exports = Drawphone;
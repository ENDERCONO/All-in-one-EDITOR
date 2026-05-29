const express = require('express');

const http = require('http');

const { Server } = require('socket.io');

const path = require('path');



const app = express();

const server = http.createServer(app);

const io = new Server(server);



// Serve your game assets and files statically from the current directory

app.use(express.static(__dirname));



const players = {};



io.on('connection', (socket) => {

  console.log(`Player connected: ${socket.id}`);



  // Handle a player joining the arena

  socket.on('join', (data) => {

    players[socket.id] = {

      id: socket.id,

      name: data.name,

      color: data.color,

      char: data.char,

      x: data.x,

      y: data.y,

      aim: 0,

      hp: 100,

      level: 1,

      points: 0,

      elims: 0,

      anim: 'idle',

      frame: 0,

      facing: 1,

      moving: false,

      alive: true

    };

    

    // Send the unique network ID back to the joining client

    socket.emit('init_id', socket.id);

    // Broadcast the full current player state to everyone

    io.emit('stateUpdate', players);

  });



  // Handle real-time low-latency movement updates

  socket.on('move', (moveData) => {

    if (players[socket.id]) {

      Object.assign(players[socket.id], moveData);

      // Broadcast this player's position to all OTHER players

      socket.broadcast.emit('playerMoved', { id: socket.id, ...moveData });

    }

  });



  // Instantly broadcast shot events so arrows don't delay

  socket.on('shoot', (shotData) => {

    socket.broadcast.emit('enemyShoot', { owner: socket.id, ...shotData });

  });



  // Authoritative server hit tracking to prevent overlapping writes/invulnerability

  socket.on('damage', (data) => {

    const target = players[data.targetId];

    const attacker = players[socket.id];

    

    if (target && target.alive) {

      target.hp = Math.max(0, target.hp - data.amount);

      

      // Tell everyone to update this player's health pool

      io.emit('healthUpdate', { id: data.targetId, hp: target.hp, fromId: socket.id });



      // Handle server-authoritative death processing

      if (target.hp <= 0 && target.alive) {

        target.alive = false;

        if (attacker) {

          attacker.elims += 1;

          attacker.points += 100;

        }

        io.emit('playerKilled', {

          killerId: socket.id,

          killerName: attacker ? attacker.name : 'Someone',

          victimId: data.targetId,

          victimName: target.name

        });

      }

    }

  });



  // Process player respawning

  socket.on('respawn', (data) => {

    if (players[socket.id]) {

      players[socket.id].hp = 100;

      players[socket.id].alive = true;

      players[socket.id].x = data.x;

      players[socket.id].y = data.y;

      io.emit('stateUpdate', players);

    }

  });



  // Clean up when a user exits or disconnects

  socket.on('disconnect', () => {

    console.log(`Player disconnected: ${socket.id}`);

    delete players[socket.id];

    io.emit('playerLeft', socket.id);

  });

});



const PORT = 3000;

server.listen(PORT, () => {

  console.log(`🚀 Claude Arena server running smoothly on http://localhost:${PORT}`);

}); 


const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

let gameState = {
    blueName: "HONG",
    redName: "CHUNG",
    blueScore: 0,
    redScore: 0,
    bluePenalty: 0,
    redPenalty: 0,
    blueRoundsWon: 0,
    redRoundsWon: 0,
    currentRound: 1,
    maxRounds: 3,
    time: 120,
    roundTimeConfig: 120,
    restTimeConfig: 60,
    isRunning: false,
    matchOver: false,
    mode: 'round', 
    winnerData: null
};

io.on('connection', (socket) => {
    socket.emit('updateState', gameState);

    socket.on('updateSettings', (data) => {
        gameState.blueName = data.blueName;
        gameState.redName = data.redName;
        gameState.roundTimeConfig = parseInt(data.roundTime);
        gameState.restTimeConfig = parseInt(data.restTime);
        gameState.maxRounds = parseInt(data.maxRounds);
        resetMatch();
        io.emit('updateState', gameState);
    });

    socket.on('action', (data) => {
        if (gameState.matchOver && data.type !== 'reset') return;

        if (data.type === 'score') {
            if (gameState.mode === 'rest') return;
            if (data.color === 'blue') gameState.blueScore += data.points;
            if (data.color === 'red') gameState.redScore += data.points;
            io.emit('playSound', 'point');
        } else if (data.type === 'penalty') {
            if (gameState.mode === 'rest') return;
            if (data.color === 'blue') {
                gameState.bluePenalty += 1;
                gameState.redScore += 1;
            }
            if (data.color === 'red') {
                gameState.redPenalty += 1;
                gameState.blueScore += 1;
            }
            io.emit('playSound', 'point');
        } else if (data.type === 'timer') {
            gameState.isRunning = !gameState.isRunning;
        } else if (data.type === 'nextRound') {
            forceNextRound();
        } else if (data.type === 'reset') {
            resetMatch();
        }
        io.emit('updateState', gameState);
    });
});

function calculateRoundWinner() {
    if (gameState.blueScore > gameState.redScore) {
        gameState.blueRoundsWon++;
    } else if (gameState.redScore > gameState.blueScore) {
        gameState.redRoundsWon++;
    }
    const winsNeeded = Math.ceil(gameState.maxRounds / 2);
    if (gameState.blueRoundsWon >= winsNeeded || gameState.redRoundsWon >= winsNeeded) {
        endMatch();
        return true; 
    }
    return false; 
}

function startRestMode() {
    const matchEnded = calculateRoundWinner();
    
    if (!matchEnded) {
        if (gameState.currentRound >= gameState.maxRounds) {
            endMatch();
        } else {
            gameState.mode = 'rest';
            gameState.time = gameState.restTimeConfig;
            gameState.isRunning = true; 
        }
    }
}

function startNextRound() {
    gameState.mode = 'round';
    gameState.currentRound++;  
    gameState.blueScore = 0;
    gameState.redScore = 0;
    gameState.bluePenalty = 0;
    gameState.redPenalty = 0;
    
    gameState.time = gameState.roundTimeConfig;
    gameState.isRunning = false; 
}

function forceNextRound() {
    if (gameState.mode === 'round') {
        startRestMode();
    } else {
        startNextRound();
    }
}

function endMatch() {
    gameState.matchOver = true;
    gameState.isRunning = false;
    let winner = 'EMPATE';
    let color = '#333';
    
    if (gameState.blueRoundsWon > gameState.redRoundsWon) {
        winner = gameState.blueName;
        color = '#0047BB';
    } else if (gameState.redRoundsWon > gameState.blueRoundsWon) {
        winner = gameState.redName;
        color = '#E21B22';
    }

    gameState.winnerData = {
        name: winner,
        color: color,
        score: `${gameState.blueRoundsWon} - ${gameState.redRoundsWon}`
    };
    
    io.emit('matchEnded', gameState.winnerData);
}

function resetMatch() {
    gameState.blueScore = 0;
    gameState.redScore = 0;
    gameState.bluePenalty = 0;
    gameState.redPenalty = 0;
    gameState.blueRoundsWon = 0;
    gameState.redRoundsWon = 0;
    gameState.currentRound = 1;
    gameState.time = gameState.roundTimeConfig;
    gameState.isRunning = false;
    gameState.matchOver = false;
    gameState.winnerData = null;
    gameState.mode = 'round';
}

setInterval(() => {
    if (gameState.isRunning && gameState.time > 0) {
        gameState.time--;
        io.emit('updateTimer', gameState.time);
    } else if (gameState.isRunning && gameState.time === 0) {
        if (gameState.mode === 'round') {
            io.emit('playSound', 'end');
            startRestMode();
        } else if (gameState.mode === 'rest') {
            startNextRound();
        }
        io.emit('updateState', gameState);
    }
}, 1000);

server.listen(3000, () => {
    console.log('http://localhost:3000');
});
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// URL oficial da Web App no Google Apps Script
const GOOGLE_SHEET_WEBAPP_URL = "https://script.google.com/macros/s/AKfycbwM8gQRX_6pqLAwPmNIOWFn71hGvpsCTuJ0qx62ksYz7CEGBFUBJpx1tb_smJIyxJS2/exec";

app.use(express.static(path.join(__dirname, 'public')));

let gameState = {
    area: "A",
    matchNumber: 1,
    category: "Sénior M -68kg",
    blueName: "HONG",
    redName: "CHUNG",
    blueScore: 0,
    redScore: 0,
    bluePenalty: 0,
    redPenalty: 0,
    blueHeadKicks: 0,
    redHeadKicks: 0,
    blueTurningKicks: 0,
    redTurningKicks: 0,
    
    regularBlueScore: 0,
    regularRedScore: 0,

    blueRoundsWon: 0,
    redRoundsWon: 0,
    currentRound: 1,
    maxRounds: 3,
    time: 90,
    roundTimeConfig: 90,
    restTimeConfig: 35,
    isRunning: false,
    matchStarted: false,
    matchOver: false,
    mode: 'round',
    isGoldenPoint: false,
    winnerData: null,
    roundsHistory: [],
    sheetSent: false
};

io.on('connection', (socket) => {
    socket.emit('updateState', gameState);

    socket.on('updateSettings', (data) => {
        if (data.area) gameState.area = data.area;
        if (data.matchNumber) gameState.matchNumber = parseInt(data.matchNumber);
        if (data.category) gameState.category = data.category;
        gameState.blueName = data.blueName;
        gameState.redName = data.redName;
        gameState.roundTimeConfig = parseInt(data.roundTime);
        gameState.restTimeConfig = parseInt(data.restTime);
        gameState.maxRounds = parseInt(data.maxRounds);
        resetMatch();
        io.emit('updateState', gameState);
    });

    socket.on('action', (data) => {
        if (gameState.matchOver && data.type !== 'reset' && data.type !== 'nextMatch') return;

        if (data.type === 'score') {
            if (gameState.mode === 'rest' || gameState.mode === 'referee_decision') return;
            gameState.matchStarted = true;
            
            if (data.color === 'blue') {
                gameState.blueScore += data.points;
                if (data.actionKind === 'head') gameState.blueHeadKicks++;
                if (data.actionKind === 'turning') gameState.blueTurningKicks++;
            }
            if (data.color === 'red') {
                gameState.redScore += data.points;
                if (data.actionKind === 'head') gameState.redHeadKicks++;
                if (data.actionKind === 'turning') gameState.redTurningKicks++;
            }
            io.emit('playSound', 'point');

            if (gameState.isGoldenPoint && (gameState.blueScore > 0 || gameState.redScore > 0)) {
                gameState.isRunning = false;
                awardRound(gameState.blueScore > gameState.redScore ? 'blue' : 'red', 'Ponto de Ouro');
            }

        } else if (data.type === 'penalty') {
            if (gameState.mode === 'rest' || gameState.mode === 'referee_decision') return;
            gameState.matchStarted = true;
            if (data.color === 'blue') {
                gameState.bluePenalty += 1;
                gameState.redScore += 1;
            }
            if (data.color === 'red') {
                gameState.redPenalty += 1;
                gameState.blueScore += 1;
            }
            io.emit('playSound', 'point');

            if (gameState.isGoldenPoint && (gameState.blueScore > 0 || gameState.redScore > 0)) {
                gameState.isRunning = false;
                awardRound(gameState.blueScore > gameState.redScore ? 'blue' : 'red', 'Ponto de Ouro (Falta)');
            }

        } else if (data.type === 'timer') {
            if (gameState.mode === 'referee_decision') return;
            gameState.isRunning = !gameState.isRunning;
            if (gameState.isRunning) gameState.matchStarted = true;

        } else if (data.type === 'refereeDecision') {
            if (gameState.mode === 'referee_decision') {
                if (data.color === 'blue') {
                    gameState.blueScore += 3;
                } else if (data.color === 'red') {
                    gameState.redScore += 3;
                }
                awardRound(data.color, 'Decisão do Árbitro (+3)');
            }

        } else if (data.type === 'nextRound') {
            forceNextRound();
        } else if (data.type === 'nextMatch') {
            endMatch();
            const nextBlue = data.blueName || gameState.blueName;
            const nextRed = data.redName || gameState.redName;
            resetMatch();
            gameState.matchNumber++;
            gameState.blueName = nextBlue;
            gameState.redName = nextRed;
        } else if (data.type === 'reset') {
            resetMatch();
        }
        io.emit('updateState', gameState);
    });
});

function evaluateRound() {
    if (gameState.blueScore > gameState.redScore) return 'blue';
    if (gameState.redScore > gameState.blueScore) return 'red';

    if (gameState.bluePenalty < gameState.redPenalty) return 'blue';
    if (gameState.redPenalty < gameState.bluePenalty) return 'red';

    if (gameState.blueHeadKicks > gameState.redHeadKicks) return 'blue';
    if (gameState.redHeadKicks > gameState.blueHeadKicks) return 'red';

    if (gameState.blueTurningKicks > gameState.redTurningKicks) return 'blue';
    if (gameState.redTurningKicks > gameState.blueTurningKicks) return 'red';

    return 'golden_point';
}

function startGoldenPoint() {
    gameState.isGoldenPoint = true;
    gameState.regularBlueScore = gameState.blueScore;
    gameState.regularRedScore = gameState.redScore;

    gameState.blueScore = 0;
    gameState.redScore = 0;
    gameState.bluePenalty = 0;
    gameState.redPenalty = 0;
    gameState.blueHeadKicks = 0;
    gameState.redHeadKicks = 0;
    gameState.blueTurningKicks = 0;
    gameState.redTurningKicks = 0;
    
    gameState.time = 20;
    gameState.isRunning = false;
    io.emit('updateState', gameState);
}

function awardRound(winnerColor, method = '') {
    if (winnerColor === 'blue') {
        gameState.blueRoundsWon++;
    } else if (winnerColor === 'red') {
        gameState.redRoundsWon++;
    }

    let finalRoundBlue = gameState.blueScore;
    let finalRoundRed = gameState.redScore;

    if (gameState.isGoldenPoint) {
        finalRoundBlue = gameState.regularBlueScore + gameState.blueScore;
        finalRoundRed = gameState.regularRedScore + gameState.redScore;
        
        gameState.blueScore = finalRoundBlue;
        gameState.redScore = finalRoundRed;
    }

    gameState.roundsHistory.push({
        round: gameState.currentRound,
        blueScore: finalRoundBlue,
        redScore: finalRoundRed,
        bluePenalty: gameState.bluePenalty,
        redPenalty: gameState.redPenalty,
        winner: winnerColor,
        method: method
    });

    gameState.isGoldenPoint = false;
    gameState.regularBlueScore = 0;
    gameState.regularRedScore = 0;

    const winsNeeded = Math.ceil(gameState.maxRounds / 2);
    if (gameState.blueRoundsWon >= winsNeeded || gameState.redRoundsWon >= winsNeeded || gameState.currentRound >= gameState.maxRounds) {
        endMatch();
    } else {
        startRestMode();
    }
    io.emit('updateState', gameState);
}

function onRoundTimeFinished() {
    if (gameState.isGoldenPoint) {
        if (gameState.blueScore === 0 && gameState.redScore === 0) {
            gameState.isRunning = false;
            gameState.mode = 'referee_decision';
            io.emit('updateState', gameState);
            return;
        } else {
            awardRound(gameState.blueScore > gameState.redScore ? 'blue' : 'red', 'Ponto de Ouro');
            return;
        }
    }

    const result = evaluateRound();
    if (result === 'golden_point') {
        startGoldenPoint();
    } else {
        awardRound(result, 'Pontuação/Critérios');
    }
}

function startRestMode() {
    gameState.mode = 'rest';
    gameState.time = gameState.restTimeConfig;
    gameState.isRunning = true;
}

function startNextRound() {
    gameState.mode = 'round';
    gameState.currentRound++;  
    gameState.blueScore = 0;
    gameState.redScore = 0;
    gameState.bluePenalty = 0;
    gameState.redPenalty = 0;
    gameState.blueHeadKicks = 0;
    gameState.redHeadKicks = 0;
    gameState.blueTurningKicks = 0;
    gameState.redTurningKicks = 0;
    gameState.regularBlueScore = 0;
    gameState.regularRedScore = 0;
    gameState.isGoldenPoint = false;
    gameState.time = gameState.roundTimeConfig;
    gameState.isRunning = false; 
}

function forceNextRound() {
    if (gameState.mode === 'round') {
        onRoundTimeFinished();
    } else if (gameState.mode === 'rest') {
        startNextRound();
    }
}

function sendResultsToGoogleSheet(payload) {
    if (!GOOGLE_SHEET_WEBAPP_URL) return;
    fetch(GOOGLE_SHEET_WEBAPP_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload),
        redirect: "follow"
    }).catch(err => console.error("Erro Google Sheets:", err));
}

function endMatch() {
    gameState.matchOver = true;
    gameState.isRunning = false;
    gameState.matchStarted = false;
    gameState.isGoldenPoint = false;
    gameState.mode = 'round';

    let winner = gameState.blueRoundsWon > gameState.redRoundsWon ? gameState.blueName : gameState.redName;
    let color = gameState.blueRoundsWon > gameState.redRoundsWon ? '#0047BB' : '#E21B22';

    gameState.winnerData = {
        name: winner,
        color: color,
        score: `${gameState.blueRoundsWon} - ${gameState.redRoundsWon}`
    };
    
    io.emit('matchEnded', gameState.winnerData);

    if (!gameState.sheetSent && gameState.roundsHistory.length > 0) {
        gameState.sheetSent = true;
        sendResultsToGoogleSheet({
            matchNumber: `${gameState.matchNumber}${gameState.area || 'A'}`,
            category: gameState.category,
            blueName: gameState.blueName,
            redName: gameState.redName,
            finalScore: `${gameState.blueRoundsWon} - ${gameState.redRoundsWon}`,
            r1: gameState.roundsHistory[0] ? `${gameState.roundsHistory[0].blueScore}-${gameState.roundsHistory[0].redScore}` : "-",
            r2: gameState.roundsHistory[1] ? `${gameState.roundsHistory[1].blueScore}-${gameState.roundsHistory[1].redScore}` : "-",
            r3: gameState.roundsHistory[2] ? `${gameState.roundsHistory[2].blueScore}-${gameState.roundsHistory[2].redScore}` : "-"
        });
    }
}

function resetMatch() {
    gameState.blueScore = 0;
    gameState.redScore = 0;
    gameState.bluePenalty = 0;
    gameState.redPenalty = 0;
    gameState.blueHeadKicks = 0;
    gameState.redHeadKicks = 0;
    gameState.blueTurningKicks = 0;
    gameState.redTurningKicks = 0;
    gameState.regularBlueScore = 0;
    gameState.regularRedScore = 0;
    gameState.blueRoundsWon = 0;
    gameState.redRoundsWon = 0;
    gameState.currentRound = 1;
    gameState.time = gameState.roundTimeConfig;
    gameState.isRunning = false;
    gameState.matchStarted = false;
    gameState.matchOver = false;
    gameState.isGoldenPoint = false;
    gameState.winnerData = null;
    gameState.mode = 'round';
    gameState.roundsHistory = [];
    gameState.sheetSent = false;
}

setInterval(() => {
    if (gameState.isRunning && gameState.time > 0) {
        gameState.time--;
        io.emit('updateTimer', gameState.time);
    } else if (gameState.isRunning && gameState.time === 0) {
        if (gameState.mode === 'round') {
            io.emit('playSound', 'end');
            onRoundTimeFinished();
        } else if (gameState.mode === 'rest') {
            startNextRound();
        }
        io.emit('updateState', gameState);
    }
}, 1000);

function getLocalIpAddress() {
    const interfaces = os.networkInterfaces();
    for (const devName in interfaces) {
        const iface = interfaces[devName];
        for (let i = 0; i < iface.length; i++) {
            const alias = iface[i];
            if (alias.family === 'IPv4' && !alias.internal) {
                return alias.address;
            }
        }
    }
    return '127.0.0.1';
}

server.listen(3000, '0.0.0.0', () => {
    const localIp = getLocalIpAddress();
    console.log('\n==========================================');
    console.log('🥋 TKD SCOREBOARD ATIVO');
    console.log('💻 Painel do PC (Admin):    http://localhost:3000/admin.html');
    console.log('📺 Ecrã da TV (Scoreboard):  http://localhost:3000/');
    console.log(`📱 Comando Telemóvel:       http://${localIp}:3000/remote.html`);
    console.log('==========================================\n');
});
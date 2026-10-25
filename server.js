const { Server } = require("socket.io");
const express = require('express');
const path = require('path');
const http = require('http');
const os = require('os');
const fs = require('fs'); 

const baseDir = process.pkg ? path.dirname(process.execPath) : __dirname;

let config = { port: 3000, googleSheetUrl: "" };
try {
    config = { ...config, ...JSON.parse(fs.readFileSync(path.join(baseDir, 'config.json'), 'utf8')) };
} catch (e) {}

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Google Apps Script - Web App URL
const GOOGLE_SHEET_WEBAPP_URL = "https://script.google.com/macros/s/AKfycbwy5PLb5i8hWukhROe7Xzrpy4xUu6LxqqqkeQwZSnv-yXp8WRTYOlXx27bomaRbT9Sm/exec";

app.use(express.static(path.join(__dirname, 'public')));

// LEITURA DA BASE DE DADOS DE ATLETAS (./database/athletes.txt)
function loadAthletes() {
    const dbPath = path.join(baseDir, 'database', 'athletes.txt');
    if (!fs.existsSync(dbPath)) return [];
    try {
        const lines = fs.readFileSync(dbPath, 'utf8').split(/\r?\n/);
        const list = [];
        lines.forEach(line => {
            const parts = line.split(';');
            if (parts.length >= 4) {
                list.push({
                    name: parts[0].trim(),
                    division: parts[1].trim(),
                    gender: parts[2].trim(),
                    weight: parts[3].trim().replace(/\s+/g, ''),
                    club: parts[4] ? parts[4].trim() : ''
                });
            }
        });
        return list;
    } catch (e) {
        console.error("Erro ao ler athletes.txt:", e);
        return [];
    }
}

let athletesDb = loadAthletes();

const POINT_GAP = 15;          
const GOLDEN_POINT_TIME = 30;  
const KYESHI_TIME = 60;        
const MAX_PENALTIES = 5;       

let gameState = {
    tournament: 1,
    area: "A",
    matchNumber: 1,
    category: "Sénior M -68kg",
    blueCategory: "Sénior M -68kg",
    redCategory: "Sénior M -68kg",
    isFriendly: false,
    blueName: "AZUL",
    redName: "VERMELHO",
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
    sheetSent: false,
    sheetResend: false,
    kyeshiActive: false,
    kyeshiTime: 0,
    varActive: false
};

io.on('connection', (socket) => {
    socket.emit('updateState', gameState);
    socket.emit('athletesList', athletesDb);

    socket.on('updateSettings', (data) => {
        if (data.tournament) gameState.tournament = parseInt(data.tournament);
        if (data.area) gameState.area = data.area;
        if (data.matchNumber) gameState.matchNumber = parseInt(data.matchNumber);
        if (data.category) gameState.category = data.category;
        gameState.blueCategory = data.blueCategory || data.category;
        gameState.redCategory = data.redCategory || data.category;
        gameState.isFriendly = !!data.isFriendly;
        gameState.blueName = data.blueName;
        gameState.redName = data.redName;
        gameState.roundTimeConfig = parseInt(data.roundTime);
        gameState.restTimeConfig = parseInt(data.restTime);
        gameState.maxRounds = parseInt(data.maxRounds);
        resetMatch();
        io.emit('updateState', gameState);
    });

    socket.on('action', (data) => {
        // RESET TOTAL: Tem prioridade absoluta
        if (data.type === 'reset') {
            resetMatch();
            io.emit('updateState', gameState);
            io.emit('updateTimer', gameState.roundTimeConfig);
            return;
        }

        if (gameState.matchOver && !['nextMatch', 'manualScore', 'removePenalty', 'var'].includes(data.type)) return;

        if (data.type === 'score') {
            if (gameState.mode === 'rest' || gameState.mode === 'referee_decision' || gameState.kyeshiActive || gameState.varActive) return;
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
            checkPointGap();

            if (gameState.isGoldenPoint && (gameState.blueScore > 0 || gameState.redScore > 0)) {
                gameState.isRunning = false;
                awardRound(gameState.blueScore > gameState.redScore ? 'blue' : 'red', 'Ponto de Ouro');
            }

        } else if (data.type === 'penalty') {
            if (gameState.mode === 'rest' || gameState.mode === 'referee_decision' || gameState.kyeshiActive || gameState.varActive) return;
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
            checkPointGap();

            if (gameState.isGoldenPoint && (gameState.blueScore > 0 || gameState.redScore > 0)) {
                gameState.isRunning = false;
                awardRound(gameState.blueScore > gameState.redScore ? 'blue' : 'red', 'Ponto de Ouro (Falta)');
            }

        } else if (data.type === 'timer') {
            if (gameState.mode === 'referee_decision' || gameState.kyeshiActive || gameState.varActive) return;
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

        } else if (data.type === 'manualScore') {
            manualAdjust(data.color, data.delta);
        } else if (data.type === 'removePenalty') {
            removePenalty(data.color);
        } else if (data.type === 'var') {
            gameState.varActive = !gameState.varActive;
        } else if (data.type === 'kyeshi') {
            toggleKyeshi();
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
        }
        io.emit('updateState', gameState);
    });
});

function checkPointGap() {
    if (gameState.mode !== 'round' || gameState.matchOver) return;

    if (gameState.bluePenalty >= MAX_PENALTIES || gameState.redPenalty >= MAX_PENALTIES) {
        gameState.isRunning = false;
        awardRound(gameState.bluePenalty >= MAX_PENALTIES ? 'red' : 'blue', `${MAX_PENALTIES} Gam-jeom`);
        return;
    }

    if (gameState.isGoldenPoint) return;
    const diff = gameState.blueScore - gameState.redScore;
    if (Math.abs(diff) >= POINT_GAP) {
        gameState.isRunning = false;
        awardRound(diff > 0 ? 'blue' : 'red', `Point Gap (${POINT_GAP})`);
    }
}

function finishedTarget() {
    const finished = (gameState.mode === 'rest' || gameState.matchOver) && gameState.roundsHistory.length > 0;
    return finished ? gameState.roundsHistory[gameState.roundsHistory.length - 1] : null;
}

function manualAdjust(color, delta) {
    if (color !== 'blue' && color !== 'red') return;
    delta = delta > 0 ? 1 : -1;
    const key = color + 'Score';
    const entry = finishedTarget();
    if (entry) {
        entry[key] = Math.max(0, entry[key] + delta);
        applyFinishedEdit(entry);
        return;
    }
    gameState[key] = Math.max(0, gameState[key] + delta);
    if (gameState.mode !== 'round') return;
    if (gameState.isGoldenPoint) {
        if (gameState.blueScore !== gameState.redScore) {
            gameState.isRunning = false;
            awardRound(gameState.blueScore > gameState.redScore ? 'blue' : 'red', 'Ponto de Ouro (Manual)');
        }
    } else {
        checkPointGap();
    }
}

function removePenalty(color) {
    if (color !== 'blue' && color !== 'red') return;
    const opp = color === 'blue' ? 'red' : 'blue';
    const entry = finishedTarget();
    const t = entry || gameState;
    t[color + 'Penalty'] = Math.max(0, t[color + 'Penalty'] - 1);
    t[opp + 'Score'] = Math.max(0, t[opp + 'Score'] - 1);
    if (entry) applyFinishedEdit(entry);
}

function applyFinishedEdit(h) {
    if (h.bluePenalty >= MAX_PENALTIES) h.winner = 'red';
    else if (h.redPenalty >= MAX_PENALTIES) h.winner = 'blue';
    else if (h.blueScore > h.redScore) h.winner = 'blue';
    else if (h.redScore > h.blueScore) h.winner = 'red';
    else if (h.bluePenalty !== h.redPenalty) h.winner = h.bluePenalty < h.redPenalty ? 'blue' : 'red';
    else if ((h.blueHeadKicks || 0) !== (h.redHeadKicks || 0)) h.winner = h.blueHeadKicks > h.redHeadKicks ? 'blue' : 'red';
    else if ((h.blueTurningKicks || 0) !== (h.redTurningKicks || 0)) h.winner = h.blueTurningKicks > h.redTurningKicks ? 'blue' : 'red';
    if (!String(h.method || '').includes('Corrigido')) h.method = (h.method || '') + ' [Corrigido]';

    gameState.blueScore = h.blueScore;
    gameState.redScore = h.redScore;
    gameState.bluePenalty = h.bluePenalty;
    gameState.redPenalty = h.redPenalty;
    gameState.blueRoundsWon = gameState.roundsHistory.filter(r => r.winner === 'blue').length;
    gameState.redRoundsWon = gameState.roundsHistory.filter(r => r.winner === 'red').length;

    const winsNeeded = Math.ceil(gameState.maxRounds / 2);
    const shouldEnd = gameState.blueRoundsWon >= winsNeeded || gameState.redRoundsWon >= winsNeeded
        || gameState.roundsHistory.length >= gameState.maxRounds;

    if (shouldEnd) {
        endMatch(gameState.matchOver);
    } else if (gameState.matchOver) {
        gameState.matchOver = false;
        gameState.winnerData = null;
        gameState.sheetSent = false;
        gameState.sheetResend = true;
        startRestMode();
    }
}

function toggleKyeshi() {
    if (gameState.matchOver || gameState.varActive) return;
    if (gameState.kyeshiActive) {
        gameState.kyeshiActive = false;
        gameState.kyeshiTime = 0;
    } else {
        gameState.kyeshiActive = true;
        gameState.kyeshiTime = KYESHI_TIME;
        gameState.isRunning = false;
    }
}

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
    
    gameState.time = GOLDEN_POINT_TIME;
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
        blueHeadKicks: gameState.blueHeadKicks,
        redHeadKicks: gameState.redHeadKicks,
        blueTurningKicks: gameState.blueTurningKicks,
        redTurningKicks: gameState.redTurningKicks,
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

function saveLocalBackup(payload) {
    try {
        const backupEntry = {
            dataHora: new Date().toLocaleString("pt-PT"),
            ...payload
        };
        fs.appendFileSync(
            path.join(baseDir, 'backup_combates.jsonl'),
            JSON.stringify(backupEntry) + '\n',
            'utf8'
        );
        console.log(`[BACKUP LOCAL] Combate ${payload.matchNumber} guardado com sucesso no disco.`);
    } catch (err) {
        console.error("❌ Erro ao guardar backup local:", err);
    }
}

function sendResultsToGoogleSheet(payload) {
    if (!GOOGLE_SHEET_WEBAPP_URL) return;
    fetch(GOOGLE_SHEET_WEBAPP_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload),
        redirect: "follow"
    })
    .then(res => res.text())
    .then(body => console.log("Resposta Google Sheets:", body))
    .catch(err => console.error("❌ Erro Google Sheets:", err));
}

function endMatch(correction = false) {
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

    if ((!gameState.sheetSent || correction) && gameState.roundsHistory.length > 0) {
        gameState.sheetSent = true;

        const formattedMatchId = `T${gameState.tournament || 1}_${gameState.area || 'A'}${gameState.matchNumber}`;

        const payload = {
            matchNumber: formattedMatchId,
            correcao: !!(correction || gameState.sheetResend),
            category: gameState.category,
            blueCategory: gameState.blueCategory || gameState.category,
            redCategory: gameState.redCategory || gameState.category,
            blueName: gameState.blueName,
            redName: gameState.redName,
            finalScore: `${gameState.blueRoundsWon} - ${gameState.redRoundsWon}`,
            r1: gameState.roundsHistory[0] ? `${gameState.roundsHistory[0].blueScore}-${gameState.roundsHistory[0].redScore}` : "-",
            r2: gameState.roundsHistory[1] ? `${gameState.roundsHistory[1].blueScore}-${gameState.roundsHistory[1].redScore}` : "-",
            r3: gameState.roundsHistory[2] ? `${gameState.roundsHistory[2].blueScore}-${gameState.roundsHistory[2].redScore}` : "-",
            amigavel: gameState.isFriendly ? "SIM" : "NÃO"
        };

        saveLocalBackup(payload);
        sendResultsToGoogleSheet(payload);
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
    gameState.sheetResend = false;
    gameState.kyeshiActive = false;
    gameState.kyeshiTime = 0;
    gameState.varActive = false;
}

setInterval(() => {
    if (gameState.varActive) return;
    if (gameState.kyeshiActive) {
        gameState.kyeshiTime--;
        if (gameState.kyeshiTime <= 0) {
            gameState.kyeshiTime = 0;
            gameState.kyeshiActive = false;
            io.emit('playSound', 'end');
            io.emit('updateState', gameState);
        } else {
            io.emit('updateTimer', gameState.kyeshiTime);
        }
        return;
    }
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

server.listen(config.port, '0.0.0.0', () => {
    const localIp = getLocalIpAddress();
    console.log('\n==========================================');
    console.log('🥋 TKD SCOREBOARD ATIVO');
    console.log('💻 Painel do PC (Admin):    http://localhost:' + config.port + '/admin.html');
    console.log('📺 Ecrã da TV (Scoreboard):  http://localhost:' + config.port + '/');
    console.log(`📱 Comando Telemóvel:       http://${localIp}:${config.port}/remote.html`);
    console.log('==========================================\n');
});
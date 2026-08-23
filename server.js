const WebSocket = require("ws");
const http = require("http");

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Minecraft Platform Fighter server is online!");
});

const wss = new WebSocket.Server({ server });

const rooms = new Map();

function makeRoomCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code;

    do {
        code = "";

        for (let i = 0; i < 4; i++) {
            code += chars[Math.floor(Math.random() * chars.length)];
        }
    } while (rooms.has(code));

    return code;
}

function send(ws, data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
    }
}

function broadcast(room, data, except = null) {
    for (const player of room.players) {
        if (player !== except) {
            send(player.ws, data);
        }
    }
}

function publicState(room) {
    return {
        type: "matchState",
        stage: room.state.stage,
        gameState: room.state.gameState,
        winnerText: room.state.winnerText || "",
        stocks: {
            p1: room.state.stocks.p1,
            p2: room.state.stocks.p2
        },
        p1: room.state.p1,
        p2: room.state.p2,
        sfx: room.state.sfx.splice(0, room.state.sfx.length),
        serverTime: Date.now()
    };
}

function broadcastMatchState(room) {
    const state = publicState(room);

    for (const player of room.players) {
        send(player.ws, state);
    }
}

function removePlayer(ws) {
    if (!ws.roomCode) return;

    const room = rooms.get(ws.roomCode);

    if (!room) return;

    room.players = room.players.filter(
        player => player.ws !== ws
    );

    broadcast(room, {
        type: "playerLeft"
    });

    if (room.players.length === 0) {
        rooms.delete(ws.roomCode);
    }
}

wss.on("connection", ws => {

    ws.roomCode = null;
    ws.playerNumber = null;

    send(ws, {
        type: "connected"
    });

    ws.on("message", raw => {

        let message;

        try {
            message = JSON.parse(raw);
        } catch {
            send(ws, {
                type: "error",
                message: "Invalid message."
            });

            return;
        }

        // -----------------------------
        // HOST MATCH
        // -----------------------------

        if (message.type === "createRoom") {

            if (ws.roomCode) {
                return;
            }

            const code = makeRoomCode();

            const room = {
                players: [],

                state: {
                    stage: "nether",

                    gameState: "ONLINE_HOST",

                    winnerText: "",

                    p1: null,

                    p2: null,

                    stocks: {
                        p1: 3,
                        p2: 3
                    },

                    sfx: []
                }
            };

            rooms.set(code, room);

            const player = {
                ws,
                number: 1
            };

            room.players.push(player);

            ws.roomCode = code;
            ws.playerNumber = 1;

            send(ws, {
                type: "roomCreated",
                roomCode: code,
                playerNumber: 1
            });

            return;
        }

        // -----------------------------
        // JOIN MATCH
        // -----------------------------

        if (message.type === "joinRoom") {

            if (ws.roomCode) {
                return;
            }

            const code = String(
                message.roomCode || ""
            )
                .trim()
                .toUpperCase();

            const room = rooms.get(code);

            if (!room) {

                send(ws, {
                    type: "error",
                    message: "Room not found."
                });

                return;
            }

            if (room.players.length >= 2) {

                send(ws, {
                    type: "error",
                    message: "Room is full."
                });

                return;
            }

            const player = {
                ws,
                number: 2
            };

            room.players.push(player);

            ws.roomCode = code;
            ws.playerNumber = 2;

            send(ws, {
                type: "roomJoined",
                roomCode: code,
                playerNumber: 2
            });

            const host = room.players.find(
                p => p.number === 1
            );

            send(host?.ws, {
                type: "playerJoined",
                playerNumber: 2
            });

            // Tell both players that the match can begin.
            for (const p of room.players) {

                send(p.ws, {
                    type: "matchReady",
                    players: room.players.length
                });
            }

            // Immediately send the joining player the
            // current authoritative room state.
            send(ws, publicState(room));

            return;
        }

        // Everything below requires a room.
        if (!ws.roomCode) {
            return;
        }

        const room = rooms.get(ws.roomCode);

        if (!room) {
            return;
        }

        // -----------------------------
        // CHARACTER SELECTION
        // -----------------------------

        if (message.type === "selectCharacter") {

            const n = ws.playerNumber;

            const key = n === 1
                ? "p1"
                : "p2";

            const character = String(
                message.character || "steve"
            );

            const name = String(
                message.name || `Player ${n}`
            );

            room.state[key] = {
                ...(room.state[key] || {}),

                character,

                name
            };

            broadcastMatchState(room);

            return;
        }

        // -----------------------------
        // STAGE SELECTION
        // -----------------------------

        if (message.type === "selectStage") {

            if (message.stage) {
                room.state.stage = String(
                    message.stage
                );
            }

            broadcastMatchState(room);

            return;
        }

        // -----------------------------
        // AUTHORITATIVE GAME STATE
        // -----------------------------

        if (message.type === "gameState") {

            const n = ws.playerNumber;

            const key = n === 1
                ? "p1"
                : "p2";

            const incoming =
                message.player || {};

            room.state[key] = {

                ...(room.state[key] || {}),

                ...incoming,

                character:
                    message.character ||
                    incoming.character ||
                    room.state[key]?.character,

                name:
                    message.name ||
                    incoming.name ||
                    room.state[key]?.name
            };

            // Stage is shared.
            if (message.stage) {

                room.state.stage =
                    String(message.stage);
            }

            // Game state is shared.
            if (message.gameState) {

                room.state.gameState =
                    String(message.gameState);
            }

            // Victory text is shared.
            if (
                typeof message.winnerText ===
                "string"
            ) {

                room.state.winnerText =
                    message.winnerText;
            }

            // Shared stock state.
            if (
                message.stocks &&
                typeof message.stocks.p1 ===
                    "number" &&
                typeof message.stocks.p2 ===
                    "number"
            ) {

                room.state.stocks.p1 =
                    message.stocks.p1;

                room.state.stocks.p2 =
                    message.stocks.p2;

            } else if (
                typeof incoming.stocks ===
                "number"
            ) {

                room.state.stocks[
                    key === "p1"
                        ? "p1"
                        : "p2"
                ] = incoming.stocks;
            }

            // SFX events.
            if (
                Array.isArray(message.sfx) &&
                message.sfx.length
            ) {

                room.state.sfx.push(
                    ...message.sfx.slice(-16)
                );

                // Prevent an audio backlog.
                if (room.state.sfx.length > 32) {

                    room.state.sfx.splice(
                        0,
                        room.state.sfx.length - 32
                    );
                }
            }

            // Send the complete current state
            // to BOTH players.
            broadcastMatchState(room);

            return;
        }

        // -----------------------------
        // INPUT
        // -----------------------------

        if (message.type === "input") {

            const sender =
                room.players.find(
                    p => p.ws === ws
                );

            broadcast(
                room,
                {
                    type: "remoteInput",

                    playerNumber:
                        ws.playerNumber,

                    input:
                        message.input
                },
                sender
            );

            return;
        }

        // -----------------------------
        // READY
        // -----------------------------

        if (message.type === "ready") {

            const sender =
                room.players.find(
                    p => p.ws === ws
                );

            broadcast(
                room,
                {
                    type: "playerReady",

                    playerNumber:
                        ws.playerNumber
                },
                sender
            );

            return;
        }

        // -----------------------------
        // REMATCH
        // -----------------------------

        if (message.type === "rematch") {

            const sender =
                room.players.find(
                    p => p.ws === ws
                );

            broadcast(
                room,
                {
                    type: "rematchRequest",

                    playerNumber:
                        ws.playerNumber
                },
                sender
            );

            return;
        }

        // -----------------------------
        // REQUEST CURRENT STATE
        // -----------------------------

        if (message.type === "syncRequest") {

            // Immediately send the newest
            // authoritative state to the
            // requesting client.
            send(
                ws,
                publicState(room)
            );

            return;
        }

        // -----------------------------
        // PING
        // -----------------------------

        if (message.type === "ping") {

            send(ws, {
                type: "pong",

                t:
                    message.t ||
                    Date.now(),

                serverTime:
                    Date.now()
            });

            return;
        }
    });

    // -----------------------------
    // DISCONNECT
    // -----------------------------

    ws.on("close", () => {
        removePlayer(ws);
    });

    ws.on("error", () => {
        removePlayer(ws);
    });
});

server.listen(PORT, () => {

    console.log(
        `Minecraft Platform Fighter server running on port ${PORT}`
    );
});

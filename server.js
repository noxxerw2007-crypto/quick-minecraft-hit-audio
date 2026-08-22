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

function removePlayer(ws) {
    if (!ws.roomCode) return;

    const room = rooms.get(ws.roomCode);

    if (!room) return;

    room.players = room.players.filter(player => player.ws !== ws);

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
                players: []
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

            const code = String(message.roomCode || "")
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

            // Tell host that player 2 joined.
            const host = room.players.find(p => p.number === 1);

            send(host?.ws, {
                type: "playerJoined",
                playerNumber: 2
            });

            // Tell both players the match can begin.
            for (const p of room.players) {
                send(p.ws, {
                    type: "matchReady",
                    players: room.players.length
                });
            }

            return;
        }

        // -----------------------------
        // GAME DATA
        // -----------------------------

        if (message.type === "gameState") {

            if (!ws.roomCode) {
                return;
            }

            const room = rooms.get(ws.roomCode);

            if (!room) {
                return;
            }

            // Send this player's state to the other player.
            broadcast(
                room,
                {
                    type: "remoteGameState",
                    playerNumber: ws.playerNumber,
                    state: message.state
                },
                {
                    ws
                }
            );

            return;
        }

        // -----------------------------
        // INPUT
        // -----------------------------

        if (message.type === "input") {

            if (!ws.roomCode) {
                return;
            }

            const room = rooms.get(ws.roomCode);

            if (!room) {
                return;
            }

            broadcast(
                room,
                {
                    type: "remoteInput",
                    playerNumber: ws.playerNumber,
                    input: message.input
                },
                {
                    ws
                }
            );

            return;
        }

        // -----------------------------
        // READY
        // -----------------------------

        if (message.type === "ready") {

            if (!ws.roomCode) {
                return;
            }

            const room = rooms.get(ws.roomCode);

            if (!room) {
                return;
            }

            broadcast(
                room,
                {
                    type: "playerReady",
                    playerNumber: ws.playerNumber
                },
                {
                    ws
                }
            );

            return;
        }

        // -----------------------------
        // REMATCH
        // -----------------------------

        if (message.type === "rematch") {

            if (!ws.roomCode) {
                return;
            }

            const room = rooms.get(ws.roomCode);

            if (!room) {
                return;
            }

            broadcast(
                room,
                {
                    type: "rematchRequest",
                    playerNumber: ws.playerNumber
                },
                {
                    ws
                }
            );

            return;
        }
    });

    ws.on("close", () => {
        removePlayer(ws);
    });

    ws.on("error", () => {
        removePlayer(ws);
    });
});

server.listen(PORT, () => {
    console.log(`Minecraft Platform Fighter server running on port ${PORT}`);
});

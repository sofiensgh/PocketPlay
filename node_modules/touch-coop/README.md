# Touch-Coop

A TypeScript library that enables couch co-op gaming on the web, using mobile devices as controllers.

<img src="https://raw.githubusercontent.com/SlaneyEE/touch-coop/main/media/logo.png" alt="Example" width="300">

## Purpose

TouchCoop is designed to allow up to four players to connect to a game server using their mobile devices as controllers. Each player can use touch controls on their device to send input events to the game.

TouchCoop is intended for playing games on a TV or monitor, while players use their phones or tablets as controllers. 

TouchCoop is ideal for casual multiplayer games, such as platformers, puzzle games, or party games. TouchCoop is not intended for games that require low-latency input, such as first-person shooters.

TouchCoop does not require servers or user accounts for gameplay. However, it requires the PeerJS server (or your own signaling server) for initial connection setup. All communication is done using WebRTC, which allows for peer-to-peer connections between the players' devices.

## Powered by PeerJS

TouchCoop is powered by [PeerJS](https://peerjs.com/), which provides a simple API for WebRTC peer-to-peer connections. By default, TouchCoop uses the public PeerJS servers for signaling and STUN/TURN services.

- **Status Page**: Check the status of PeerJS public servers at [https://status.peerjs.com/](https://status.peerjs.com/).
- **Custom Servers**: If you need more control or reliability, you can deploy your own PeerJS server. See the [PeerJS documentation](https://peerjs.com/docs/#start) for instructions on setting up your own server. You can pass custom PeerJS options to the `Match` and `Player` constructors to connect to your own server.

```ts
// Example: Using a custom PeerJS server
import { Match, Player } from "touch-coop";
const customPeerConfig = {
    host: 'your-peerjs-server.com',
    port: 9000,
    path: '/peerjs'
};

const match = new Match();
await match.createLobby(gamePadURL, handlePlayerEvent, customPeerConfig);
const player = new Player(customPeerConfig);
```

## Installation

```bash
npm install touch-coop
```

## Usage

The library expects your game to use the `Match` and `Player` classes. Your game will require a minimum of two pages with unique URLs:

### 1. Match (Shared TV/Monitor)

The main game page hosts the game and creates a `Match` instance. This page uses `createLobby()` to generate a QR code that players can scan to join the game.

```ts
import { Match, type PlayerEvent } from "touch-coop";

// PlayerEvent type:
// type PlayerEvent =
//   | { action: "JOIN" | "LEAVE"; playerId: string; playerName: string; timestamp: number; }
//   | { action: "MOVE"; playerId: string; playerName: string; button: string; timestamp: number; }

const gamePadURL = "http://localhost:8080/demos/gamepad";

function handlePlayerEvent(event: PlayerEvent) {
    switch (event.action) {
        case "JOIN":
            console.log(`Player ${event.playerId} ${event.playerName} joined the game.`);
            break;
        case "LEAVE":
            console.log(`Player ${event.playerId} ${event.playerName} left the game.`);
            break;
        case "MOVE":
            console.log(`Player ${event.playerId} ${event.playerName} pressed ${event.button}`);
            break;
    }
}

export function Lobby() {
    const [lobby, setLobby] = React.useState<{
        dataUrl: string;
        shareURL: string;
    } | null>(null);

    React.useEffect(() => {
        (async () => {
            if (lobby === null) {
                const match = new Match();
                const { dataUrl, shareURL } = await match.createLobby(
                    gamePadURL, handlePlayerEvent
                );
                setLobby({ dataUrl, shareURL });
            }
        })();
    }, [lobby]);

    return lobby === null ? (
        <div>
            <button onClick={() => setLobby(null)}>Create Lobby</button>
        </div>
    ) : (
        <div>
            <p>Scan the QR code below to join the game:</p>
            <img src={lobby.dataUrl} alt="GamePad QR Code" />
            <a href={lobby.shareURL} target="_blank" rel="noopener noreferrer">Join</a>
        </div>
    );
}
```

### 2. Virtual Controller (Mobile device)

Each player scans a QR code to join the game. The QR code contains a unique URL that opens a web page with touch controls. This page uses the `Player` class to connect to the game match with `player.joinMatch()` and send input events with `player.sendMove("X")`.

```ts
import React from "react";
import { Player } from "touch-coop";

const player = new Player();

export default function GamePad() {
    const [loading, setLoading] = React.useState(true);

    React.useEffect(() => {
        ```ts
        import React from "react";
        import { Player } from "touch-coop";

        const player = new Player();

        export default function GamePad() {
            const [loading, setLoading] = React.useState(true);

            React.useEffect(() => {
                (async () => {
                    const playerName = prompt("Enter your player name:") || "Player";
                    await player.joinMatch(playerName);
                    setLoading(false);
                })();
            }, []);

            if (loading) {
                return <div>Loading…</div>;
            }

            return (
                <div>
                    <button onClick={() => player.sendMove("up")}>Up</button>
                    <button onClick={() => player.sendMove("down")}>Down</button>
                    <button onClick={() => player.sendMove("left")}>Left</button>
                    <button onClick={() => player.sendMove("right")}>Right</button>
                    <button onClick={() => player.sendMove("A")}>A</button>
                    <button onClick={() => player.sendMove("B")}>B</button>
                    <button onClick={() => player.sendMove("X")}>X</button>
                    <button onClick={() => player.sendMove("Y")}>Y</button>
                </div>
            );
        }
        ```

You can try a live demo of TouchCoop at [https://SlaneyEE.github.io/touch-coop/demos/match.html](https://SlaneyEE.github.io/touch-coop/demos/match.html).

The demo contains a simple game where players can join by scanning a QR Code and use their mobile devices as controllers. Each player can use the on-screen buttons to send input events to the game.

The game page is [./demos/match.html](./demos/match.html). The QR code redirects players to [./demos/gamepad/index.html](./demos/gamepad/index.html).

You need to run a local server to host the demo files. You can use a simple HTTP server like `http-server` or `live-server` to serve the files from the `root` directory and then access `http://localhost:8080/demos/match.html` in your browser.

---

### Match PUBLIC API (v3)

#### PlayerEvent type

```ts
type PlayerEvent =
    | { action: "JOIN" | "LEAVE"; playerId: string; playerName: string; timestamp: number; }
    | { action: "MOVE"; playerId: string; playerName: string; button: string; timestamp: number; };
```

#### Match constructor

```ts
new Match(gamepadUiUrl: string, onPlayerEvent: (event: PlayerEvent) => void)
```

#### createLobby

```ts
async createLobby(peerConfig?: Peer.PeerOptions): Promise<{ dataUrl: string; shareURL: string; }>
```

#### getInvitationStatus

```ts
getInvitationStatus(playerId: string): boolean | undefined
```

#### destroy

```ts
destroy(): void
```

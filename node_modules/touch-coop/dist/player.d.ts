import { type PeerOptions } from "peerjs";
export declare class Player {
    private _peer;
    private _playerId;
    private _dataConnection;
    private _ownIdPromise;
    private _playerName;
    constructor(peerConfig?: PeerOptions);
    joinMatch(playerName: string): Promise<void>;
    sendMove(button: string): Promise<void>;
    get isConnected(): boolean;
    destroy(): void;
}
//# sourceMappingURL=player.d.ts.map
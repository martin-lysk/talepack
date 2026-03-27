export interface SyncReader {
	readSync(buffer: Uint8Array, position: number, length: number): number
	size(): number
}

export type BlockDeflationInfo = {
	blockSize: number
	header: Uint8Array
	hash: string;
	blocks: { 
		hash: string;
		start: number; 
		end: number 
	}[]
}

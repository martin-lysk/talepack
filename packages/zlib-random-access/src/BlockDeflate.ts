import * as pako from "pako";
import type { BlockDeflationInfo } from "./BlockDeflationInfo.js";
import { SHA1 } from "@oslojs/crypto/sha1";

export class BlockDeflate extends pako.Deflate {
	positionInBlock: number = 0;
	bytesCurrentBlock: Uint8Array;
	deflationInfo: BlockDeflationInfo = {
		header: new Uint8Array(2),
		blockSize: -1,
		hash: "not-set",
		blocks: [
			{
				hash: "not-set",
				start: 2, // first block starts after the header
				end: -1,
			},
		],
	};

	currentOffset = 0;

	chunks: Uint8Array[] = [];

	constructor(options: pako.DeflateOptions & { blockSize: number }) {
		super(options);
		// @ts-expect-error -- internal property access https://github.com/nodeca/pako/blob/893381abcafa10fa2081ce60dae7d4d8e873a658/lib/deflate.js#L146
		super.chunks = this.chunks;
		this.deflationInfo.blockSize = options.blockSize;
		this.bytesCurrentBlock = new Uint8Array(options.blockSize);
	}

	override push(data: Uint8Array, mode?: pako.FlushValues | boolean): boolean {
		const blockSize = this.deflationInfo.blockSize;
		if (this.positionInBlock + data.byteLength > blockSize) {
			// more bytes pushed than fit on the current block
			const bytesLeft = blockSize - this.positionInBlock;
			const dataToPush = data.subarray(0, bytesLeft);

			const hasher = new SHA1();
			hasher.update(dataToPush);
			const blockHash = Array.from(hasher.digest())
				.map((byte) => byte.toString(16).padStart(2, "0"))
				.join("");
			this.bytesCurrentBlock.set(dataToPush, this.positionInBlock);

			super.push(dataToPush, pako.constants.Z_FULL_FLUSH as pako.FlushValues);

			this.positionInBlock = 0;
			this.deflationInfo.blocks.push({
				hash: blockHash,
				start: this.currentOffset,
				end: -1,
			});
			const unwrittenBytes = data.subarray(bytesLeft, data.length);
			return this.push(unwrittenBytes, mode);
		} else if (this.positionInBlock + data.byteLength === blockSize) {
			this.bytesCurrentBlock.set(data, this.positionInBlock);

			const hasher = new SHA1();
			hasher.update(this.bytesCurrentBlock);
			const blockHash = Array.from(hasher.digest())
				.map((byte) => byte.toString(16).padStart(2, "0"))
				.join("");

			this.deflationInfo.blocks[this.deflationInfo.blocks.length - 1]!.hash =
				blockHash;

			const result = super.push(
				data,
				mode ? mode : (pako.constants.Z_FULL_FLUSH as pako.FlushValues)
			);

			if (mode !== true) {
				// prepare the next block
				this.positionInBlock = 0;
				this.deflationInfo.blocks.push({
					hash: "not-set",
					start: this.currentOffset,
					end: -1,
				});
			}
			return result;
		} else {
			this.bytesCurrentBlock.set(data, this.positionInBlock);
			this.positionInBlock += data.byteLength;
			return super.push(data, mode);
		}
	}

	/**
	 * Deflate#onData(chunk) -> Void
	 * - chunk (Uint8Array): output data.
	 *
	 * By default, stores data blocks in `chunks[]` property and glue
	 * those in `onEnd`. Override this handler, if you need another behaviour.
	 **/
	override onData(chunk: Uint8Array): void {
		this.chunks.push(chunk);
		if (this.chunks.length === 1) {
			// get the header from the first block
			this.deflationInfo.header = this.chunks[0]!.subarray(0, 2);
		}
		let deflatedEndOffset = 0;
		for (let i = 0, l = this.chunks.length; i < l; i++) {
			deflatedEndOffset += this.chunks[i]!.length;
		}

		this.deflationInfo.blocks[this.deflationInfo.blocks.length - 1]!.end =
			deflatedEndOffset;
		this.currentOffset = deflatedEndOffset;
	}

	override onEnd(status: number): void {
		super.onEnd(status);

		// last window not hashed yet...
		if (
			this.deflationInfo.blocks[this.deflationInfo.blocks.length - 1]?.hash ===
			"not-set"
		) {
			const hasher = new SHA1();
			hasher.update(this.bytesCurrentBlock.subarray(0, this.positionInBlock));
			const blockHash = Array.from(hasher.digest())
				.map((byte) => byte.toString(16).padStart(2, "0"))
				.join("");
			this.deflationInfo.blocks[this.deflationInfo.blocks.length - 1]!.hash =
				blockHash;
		}

		const objHash = new SHA1();
		for (const block of this.deflationInfo.blocks) {
			objHash.update(new TextEncoder().encode(block.hash));
		}

		this.deflationInfo.hash = Array.from(objHash.digest())
			.map((byte) => byte.toString(16).padStart(2, "0"))
			.join("");
		this.positionInBlock = 0;
	}
}

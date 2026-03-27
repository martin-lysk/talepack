import pako from "pako";
import type { BlockDeflationInfo } from "./BlockDeflationInfo.js";
import type { SyncReader } from "./types/SyncReaderInterface.js";

export class BlockInflate extends pako.Inflate {
	deflationInfo: Pick<BlockDeflationInfo, "header">;

	constructor(
		options: pako.InflateOptions & {
			deflationInfo: Pick<BlockDeflationInfo, "header">;
		}
	) {
		super(options);

		this.deflationInfo = options.deflationInfo;
	}

	static inflateBlockChunk(
		blockChunk: Uint8Array,
		options: pako.InflateOptions & {
			deflationInfo: Pick<BlockDeflationInfo, "header">;
		}
	): Uint8Array {
		const inflator = new BlockInflate(options);

		// 	const blockChunkWithHeader = new Uint8Array(blockChunk.length + 2)
		// 	blockChunkWithHeader.set(options.deflationInfo.header, 0)

		// console.log(blockChunkWithHeader)
		// blockChunkWithHeader.set(blockChunk, 2)

		const blockChunkWithHeader = new Uint8Array([
			options.deflationInfo.header[0]!,
			options.deflationInfo.header[1]!,
			...blockChunk,
		]);

		inflator.push(blockChunkWithHeader, false);

		// @ts-expect-error -- types are wrong
		if (inflator.err !== 0 && inflator.strm.total_out === 0) {
			throw new Error(inflator.msg);
		}

		// we don't use the result - since we can't use the checksum in partial inflate
		// @ts-expect-error -- types are wrong
		return (inflator.strm.output as Uint8Array).subarray(
			0,
			// @ts-expect-error -- types are wrong
			inflator.strm.total_out
		);
	}

	static getBlockChunk(
		data: Uint8Array,
		blockIndex: number,
		options: { deflationInfo: BlockDeflationInfo },
		offset: number = 0
	): Uint8Array {
		const blockOffsets = options.deflationInfo.blocks[blockIndex]!;
		return data.subarray(blockOffsets.start + offset, blockOffsets.end + offset);
	}

	static readBlockRangeSync(
		reader: SyncReader,
		start: number,
		length: number,
		options: { deflationInfo: BlockDeflationInfo },
		offset: number
	): Uint8Array {
		const blockSize = options.deflationInfo.blockSize;
		const startBlockIndex = Math.floor(start / blockSize);
		const end = start + length;
		const endBlockIndex = Math.floor((end - 1) / blockSize);

		const startOffset = start % blockSize;
		const endOffset = (end - 1) % blockSize;

		const result = new Uint8Array(length);
		let resultOffset = 0;

		for (
			let blockIndex = startBlockIndex;
			blockIndex <= endBlockIndex;
			blockIndex++
		) {
			const blockDeflated = BlockInflate.readDeflatedBlockSync(
				reader,
				blockIndex,
				options,
				offset
			);
			const block = this.inflateBlockChunk(blockDeflated, options);

			let sliceStart = 0;
			let sliceEnd = blockSize;

			if (blockIndex === startBlockIndex) {
				sliceStart = startOffset;
			}

			if (blockIndex === endBlockIndex) {
				sliceEnd = endOffset;
			}

			const chunk = block.slice(sliceStart, sliceEnd + 1);
			result.set(chunk, resultOffset);
			resultOffset += chunk.length;
		}

		return result;
	}

	static readDeflatedBlockSync(
		reader: SyncReader,
		blockIndex: number,
		options: { deflationInfo: Pick<BlockDeflationInfo, "blockSize" | "blocks"> },
		offset: number = 0
	): Uint8Array {
		const blockOffsets = options.deflationInfo.blocks[blockIndex]!;
		const deflatedBlock = new Uint8Array(blockOffsets.end - blockOffsets.start);
		reader.readSync(
			deflatedBlock,
			blockOffsets.start + offset,
			deflatedBlock.length
		);
		return deflatedBlock;
	}
}

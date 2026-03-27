import { describe, it, expect, beforeEach } from "vitest";

import { BlockDeflate } from "./BlockDeflate.js";
import { BlockInflate } from "./BlockInflate.js";

describe("BlockInflate", () => {
	// let deflate: BlockDeflate;
	// const blockSize = 512; // Example block size

	beforeEach(() => {
		// deflate = new BlockDeflate({ level: 6, blockSize });
	});

	it("should deflate and allow inflation of only the middle part of a 1200-byte input", () => {
		const blockSize = 512;
		const deflate = new BlockDeflate({ level: 6, blockSize });

		const blocks = [
			"A".repeat(512), // Block 0
			"B".repeat(512), // Block 1
			"C".repeat(512), // Block 2
			"D".repeat(512), // Block 3
			"E".repeat(100), // Block 4 (partial)
		];

		// Create 3 blocks containg A, B and C
		const inputStr = blocks.join("");

		const inputData = new TextEncoder().encode(inputStr);

		// Deflate the input data
		deflate.push(inputData, true); // `true` ensures the finalization

		const deflatedData = deflate.result;
		const deflationInfo = deflate.deflationInfo;

		// Ensure we have correct blockOffsets and chunks
		expect(deflate.deflationInfo.blocks.length).toEqual(5);

		const deflatedBlocksData = [];
		const inflatedBlocks = [];
		const inflatedBlockStrings = [];
		for (let i = 0; i < blocks.length; i++) {
			const deflatedBlock = BlockInflate.getBlockChunk(deflatedData, i, {
				deflationInfo,
			});
			deflatedBlocksData.push(deflatedBlock);
			const inflatedBlock = BlockInflate.inflateBlockChunk(deflatedBlock, {
				deflationInfo,
			});

			inflatedBlockStrings.push(
				new TextDecoder().decode(inflatedBlock as Uint8Array)
			);

			inflatedBlocks.push(inflatedBlock);
		}

		expect(inflatedBlockStrings).toStrictEqual(blocks);

		// // Get the start and end offsets for the middle block
		// const firstBlockIndex = 0
		// const { start: firstStart, end: firstEnd } = deflate.deflationInfo.blocks[firstBlockIndex]
		// const length = deflate.result.byteLength
		// const blockoffsets = deflate.deflationInfo.blocks

		// const lastBlockIndex = 2
		// const { start, end } = deflate.deflationInfo.blocks[lastBlockIndex]

		// // Extract the middle compressed part

		// const startCompressedArray = deflate.result.subarray(firstStart, 2)
		// // const middleCompressedArray = new Uint8Array(middleCompressedData)
		// const endCompressedArray = deflate.result.subarray(start, end)

		// const combinedArray = new Uint8Array(startCompressedArray.length + endCompressedArray.length)
		// combinedArray.set(startCompressedArray, 0) // Copy `header` at the start
		// combinedArray.set(endCompressedArray, startCompressedArray.length)

		// // Inflate the middle part to check if it decompresses correctly
		// const inflate = new pako.Inflate({
		// 	// raw: true,
		// 	// windowBits: 47,
		// })
		// inflate.push(startCompressedArray, false) // `true` to finish inflation
		// inflate.push(endCompressedArray, true) // `true` to finish inflation
		// // inflate.push(combinedArray, true) // `true` to finish inflation

		// console.log(inflate)
		// const output = new TextDecoder().decode(inflate.strm.output as Uint8Array)

		// const startstr = output.substring(0, 512)
		// const endstr = output.substring(512, 1024)

		// const expectedMiddleOutput = "A".repeat(blockSize) // Middle should match block size content

		// expect(middleOutputStr).toBe(expectedMiddleOutput)
	});
});

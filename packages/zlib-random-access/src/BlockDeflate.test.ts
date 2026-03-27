import { describe, it, expect, beforeEach } from "vitest";
import { BlockDeflate } from "./BlockDeflate.js";

describe("BlockDeflate", () => {
	let deflate: BlockDeflate;

	// Example block size
	const blockSize = 512; 

	beforeEach(() => {
		deflate = new BlockDeflate({ level: 6, blockSize });
	});

	it("should initialize with correct block size", () => {
		expect(deflate.deflationInfo.blockSize).toBe(blockSize);
		expect(deflate.positionInBlock).toBe(0);
		expect(deflate.deflationInfo.blocks).toEqual([
			{
				end: -1,
				start: 2,
				hash: "not-set",
			},
		]);
		expect(deflate.chunks).toEqual([]);
	});

	it("should deflate data and store chunks", () => {
		const data = new Uint8Array([1, 2, 3, 4, 5]);
		deflate.push(data, true);

		expect(deflate.result.length).toBeGreaterThan(0);
		expect(deflate.result).toBeInstanceOf(Uint8Array);
		expect(deflate.result.length).toBeGreaterThan(0);
		expect(deflate.deflationInfo.blocks.length).toBe(1);
	});

	it("should handle data smaller than block size", () => {
		const data = new Uint8Array(200); // Less than block size
		deflate.push(data, true);

		expect(deflate.deflationInfo.blocks.length).toBe(1);
		expect(deflate.positionInBlock).toBe(0);
	});

	it("should create a new block when data exceeds block size", () => {
		const data = new Uint8Array(blockSize + blockSize / 2); // Exceeds block size
		deflate.push(data, true);

		expect(deflate.deflationInfo.blocks.length).toBe(2);
	});

	it("should handle multiple pushes with offsets recorded correctly", () => {
		const dataHalfABlock = new Uint8Array(blockSize / 2);
		const dataOneBlock = new Uint8Array(blockSize);

		deflate.push(dataHalfABlock);
		deflate.push(dataOneBlock, true); // Force push

		expect(deflate.deflationInfo.blocks.length).toBe(2);
		expect(deflate.deflationInfo.blocks[0]!.end).toBeGreaterThan(0);
		expect(deflate.positionInBlock).toBe(0);
	});

	it("should create an accurate index array for chunks", () => {
		const chunkOnBlock = new Uint8Array(blockSize); // Fills one block
		const chunkOneAndAHalfBlock = new Uint8Array(blockSize + blockSize / 2); // Starts a new block

		deflate.push(chunkOnBlock);
		deflate.push(chunkOneAndAHalfBlock, true);

		expect(deflate.deflationInfo.blocks.length).toBe(3);
		expect(deflate.deflationInfo.blocks[0]!.start).toBe(2);
		expect(deflate.deflationInfo.blocks[1]!.end).toBeGreaterThan(
			deflate.deflationInfo.blocks[0]!.end
		);
	});

	it("should correctly finalize deflation", () => {
		const data = new Uint8Array(blockSize * 2);
		deflate.push(data, true);

		expect(deflate.deflationInfo.blocks.length).toBe(2);
		expect(deflate.positionInBlock).toBe(0);
	});

	it("should correctly handle block sized pushes", () => {
		const block1 = new Uint8Array(blockSize);
		deflate.push(block1);

		const block2 = new Uint8Array(blockSize);
		deflate.push(block2, true);

		expect(deflate.deflationInfo.blocks.length).toBe(2);
		expect(deflate.positionInBlock).toBe(0);
	});

	it("should correctly finalize deflation", () => {
		const test_db = new Uint8Array([
			0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
		]);
		const blockSize = 512;
		const deflate = new BlockDeflate({ level: 6, blockSize });

		deflate.push(test_db); 

		// @ts-expect-error -- private property
		expect(deflate.ended).toBe(false);
		expect(deflate.result).toBe(undefined);

		deflate.push(test_db, true); // `true` ensures the finalization
		expect(deflate.result).not.toBe(undefined);
	});
});

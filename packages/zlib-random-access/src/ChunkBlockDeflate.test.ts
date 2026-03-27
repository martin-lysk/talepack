import { describe, it, expect, beforeEach } from "vitest";

import { ChunkBlockDeflate } from "./ChunkBlockDeflate.js";
import { BlockInflate } from "./BlockInflate.js";

describe("BlockDeflate", () => {
	let deflate: ChunkBlockDeflate;
	const blockSize = -1; // Example block size

	beforeEach(() => {
		deflate = new ChunkBlockDeflate({ level: 6 });
	});

	it("should initialize with correct block size", () => {
		const deflate = new ChunkBlockDeflate({ level: 6 });
		expect(deflate.deflationInfo.blockSize).toBe(blockSize);
		expect(deflate.bytesCurrentBlock).toBe(0);
		expect(deflate.chunks).toEqual([]);
	});

	it("should deflate data and store chunks", () => {
		const chunk1 = new Uint8Array([1, 2, 3, 4, 5]);
		const chunk2 = new Uint8Array([1, 2, 3, 4, 5]);
		deflate.pushChunk(chunk1, "not-set");
		deflate.pushChunk(chunk2, "not-set", true);

		expect(deflate.deflationInfo.blocks.length).toBe(2);
		expect(deflate.result.length).toBeGreaterThan(0);
		expect(deflate.result).toBeInstanceOf(Uint8Array);
		expect(deflate.deflationInfo.blocks[0]!.start).toBe(2);
		expect(deflate.deflationInfo.blocks[0]!.end).toBe(
			deflate.deflationInfo.blocks[1]!.start
		);
		expect(deflate.deflationInfo.blocks[1]!.end).toBeGreaterThan(
			deflate.deflationInfo.blocks[1]!.start
		);
	});
});

describe("ChunkBlockDeflate", () => {
	let deflate: ChunkBlockDeflate;
	const blockSize = -1; // Example block size

	beforeEach(() => {
		deflate = new ChunkBlockDeflate({ level: 6 });
	});

	it("should initialize with correct block size", () => {
		const deflate = new ChunkBlockDeflate({ level: 6 });
		expect(deflate.deflationInfo.blockSize).toBe(blockSize);
		expect(deflate.bytesCurrentBlock).toBe(0);
		expect(deflate.chunks).toEqual([]);
	});

	// header 2
	// 1 -> 7
	// 2 -> 7
	// 3 -> 7
	// 4,5 -> 8

	it("should deflate data and store chunks", () => {
		const deflate2 = new ChunkBlockDeflate({ level: 6 });
		const chunk12 = new Uint8Array([2, 2, 2]);
		const chunk22 = new Uint8Array([2]);
		const chunk32 = new Uint8Array([2]);
		const chunk52 = new Uint8Array([2, 2]);
		const chunk62 = new Uint8Array([2]);
		deflate2.pushChunk(chunk12, "not-set");
		deflate2.pushChunk(chunk22, "not-set");
		deflate2.pushChunk(chunk32, "not-set");
		deflate2.pushChunk(chunk52, "not-set");
		deflate2.pushChunk(chunk62, "not-set", true);

		const buffer2 = deflate2.result.buffer;

		const deflate1 = new ChunkBlockDeflate({ level: 6 });
		const chunk1 = new Uint8Array([1, 2, 3, 4, 5]);
		const chunk2 = new Uint8Array([6]);
		deflate1.pushChunk(chunk1, "not-set");
		deflate1.pushChunk(chunk2, "not-set", true);

		const buffer1 = deflate1.result.buffer;

		expect(deflate1.deflationInfo.blocks.length).toBe(2);
		expect(deflate1.result.length).toBeGreaterThan(0);
		expect(deflate1.result).toBeInstanceOf(Uint8Array);
		expect(deflate1.deflationInfo.blocks[0]!.start).toBe(2);
		expect(deflate1.deflationInfo.blocks[0]!.end).toBe(
			deflate1.deflationInfo.blocks[1]!.start
		);
		expect(deflate1.deflationInfo.blocks[1]!.end).toBeGreaterThan(
			deflate1.deflationInfo.blocks[1]!.start
		);

		const deflatedChunk1 = BlockInflate.getBlockChunk(deflate1.result, 0, {
			deflationInfo: deflate1.deflationInfo,
		});

		const inflatedChunk1 = BlockInflate.inflateBlockChunk(deflatedChunk1, {
			deflationInfo: deflate1.deflationInfo,
		});

		expect(chunk1).toStrictEqual(inflatedChunk1);

		console.log(buffer2);
	});

	// it("should deflate data and store chunks", () => {
	// 	const deflate1 = new ChunkBlockDeflate({ level: 6 });
	// 	const chunk1 = new Uint8Array([1, 2, 3, 4, 5]);
	// 	deflate1.pushChunk(chunk1, "not-set");

	// 	const chunk2Part1 = new Uint8Array([6, 7, 8]);
	// 	const chunk2Part2 = new Uint8Array([9, 10]);
	// 	deflate1.pushChunk(chunk2Part1, "not-set", true);
	// 	deflate1.pushChunk(chunk2Part2, "not-set", true);

	// 	const chunk3 = new Uint8Array([10, 11, 12, 13, 14]);
	// 	deflate1.pushChunk(chunk2, "not-set", true);

	// 	const buffer1 = deflate1.result.buffer;

	// 	expect(deflate1.deflationInfo.blocks.length).toBe(2);
	// 	expect(deflate1.result.length).toBeGreaterThan(0);
	// 	expect(deflate1.result).toBeInstanceOf(Uint8Array);
	// 	expect(deflate1.deflationInfo.blocks[0]!.start).toBe(2);
	// 	expect(deflate1.deflationInfo.blocks[0]!.end).toBe(
	// 		deflate1.deflationInfo.blocks[1]!.start
	// 	);
	// 	expect(deflate1.deflationInfo.blocks[1]!.end).toBeGreaterThan(
	// 		deflate1.deflationInfo.blocks[1]!.start
	// 	);

	// 	const deflatedChunk1 = BlockInflate.getBlockChunk(deflate1.result, 0, {
	// 		deflationInfo: deflate1.deflationInfo,
	// 	});

	// 	const inflatedChunk1 = BlockInflate.inflateBlockChunk(deflatedChunk1, {
	// 		deflationInfo: deflate1.deflationInfo,
	// 	});

	// 	expect(chunk1).toStrictEqual(inflatedChunk1);
	// });
});

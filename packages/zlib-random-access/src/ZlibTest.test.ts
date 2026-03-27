import pako from "pako";
import { describe, expect, test } from "vitest";

describe("Zlib - tests", () => {
	test("behaviour of the footer", () => {
 
		const contentOneInflationWindow = new Uint8Array(256 * 256 - 5).fill(13);

        // header-1: 2 bytes type of the zlib
        // header-2: 5 bytes length inclusive content?

        const headerLength = 2; // type of zlib
        const lengthEncoding = 5 // how many bytes this chunk contains
        const footer = 4; // checksume

		const result = pako.deflate(contentOneInflationWindow, { level: 0 });

        expect(result[headerLength + lengthEncoding - 1], "element at 7 should be header not content").not.toBe(13); // New file should be empty
        expect(result[headerLength + lengthEncoding], "element at 8 should be content").toBe(13); // New file should be empty
        expect(result[result.length - 4], "the last 4 elements should be footer").not.toBe(13); // New file should be empty
        expect(result.length).toBe(contentOneInflationWindow.length + headerLength + lengthEncoding + footer); // New file should be empty


    });

    test("behaviour of the footer 2", () => {
         
		const contentTwoInflationWindow = new Uint8Array((256 * 256 - 5) + (256 * 256)).fill(13);

        // header-1: 2 bytes type of the zlib
        // header-2: 5 bytes length inclusive content?

        const headerLength = 2; // type of zlib
        const lengthEncoding = 5 // how many bytes this chunk contains
        const footer = 4; // checksume

		const result = pako.deflate(contentTwoInflationWindow, { level: 0 });

        expect(result[headerLength + lengthEncoding - 1], "element at 7 should be header not content").not.toBe(13); // New file should be empty
        expect(result[headerLength + lengthEncoding], "element at 8 should be content").toBe(13); // New file should be empty
        expect(result[result.length - 4], "the last 4 elements should be footer").not.toBe(13); // New file should be empty
        expect(result.length).toBe(contentTwoInflationWindow.length + headerLength + lengthEncoding + lengthEncoding + footer); // New file should be empty


        // expect(result[7 + (256 * 256)], "element at 64 k + header should be header not content").toBe(13); // New file should be empty
        // expect(result[7 + (256 * 256 + 1)], "element at 64 k should be header not content").not.toBe(13); // New file should be empty
        // expect(result[6 + (256 * 256 + 7)], "element at 64 k should be header not content").not.toBe(13); // New file should be empty
        // expect(result[6 + (256 * 256 + 8)], "element at 64 k should be content").toBe(13); // New file should be empty

		console.log("test");

		// expect(header).toEqual(new Uint8Array([0b00110000])); // New file should be empty
	});
});

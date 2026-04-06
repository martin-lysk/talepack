import { describe, it, expect } from "vitest";
import { execSync } from "child_process";

import fs from "fs";
import { tmpdir } from "os";
import { join } from "path";
import * as pako from "pako";
import { BlockInflate, ChunkBlockDeflate } from "@talepack/zlib-random-access";

describe("loose object test", () => {
	it("should create a simple git blob and verify its content", () => {
		// Create a temp dir
		const tempDir = fs.mkdtempSync(join(tmpdir(), "git-simple-test-"));

		try {

			// ---------------------------------------------------------------------------------------------------------------------------------------------------
			// 1. Create a normal git object containing `Hi beautiful World, how you are doing on this beautiful World, what a beautiful World to live on.`
			// ---------------------------------------------------------------------------------------------------------------------------------------------------

			// Create a git repo in it using init
			execSync(`git init "${tempDir}"`, { encoding: "utf-8", cwd: tempDir });

			// Create a readme containing "Hi beautiful World, how you are doing on this beautiful World, what a beautiful World to live on."
			const readmePath = join(tempDir, "readme.md");
			fs.writeFileSync(readmePath, "Hi beautiful World, how you are doing on this beautiful World, what a beautiful World to live on.");

			// Use git add to add the readme
			execSync(`git add readme.md`, { encoding: "utf-8", cwd: tempDir });

			// Use `git hash-object readme.md` to get the hash
			const hashOutput = execSync(`git hash-object readme.md`, {
				encoding: "utf-8",
				cwd: tempDir,
			}).trim();
			const blobHash = hashOutput;

			// ---------------------------------------------------------------------------------------------------------------------------------------------------
			// 2. Read the deflated blob content and inflate it using pako and split the content into `header`, `block 1` and `block 2`
			// ---------------------------------------------------------------------------------------------------------------------------------------------------

			// Read the compressed blob file content
			const objectPath = join(
				tempDir,
				".git",
				"objects",
				blobHash.slice(0, 2),
				blobHash.slice(2)
			);
			const compressedData = fs.readFileSync(objectPath);

			// Use pako to inflate the blob file into a buffer
			const inflated = pako.inflate(compressedData);
			const inflatedString = Buffer.from(inflated).toString("utf-8");
			
			// Verify the content matches "blob 12\0hello world"
			// The format is: "blob <size>\0<content>"
			// "hello world" is 12 bytes
			console.log("inflatedString should be: 'blob 97\0Hi beautiful World, how you are doing on this beautiful World, what a beautiful World to live on.'\n", inflatedString === 'blob 97\0Hi beautiful World, how you are doing on this beautiful World, what a beautiful World to live on.', '');
			expect(inflatedString).toBe("blob 97\0Hi beautiful World, how you are doing on this beautiful World, what a beautiful World to live on.");

			const header = inflatedString.split("\0")[0]! + "\0";
			const block1 = inflatedString.substring(header.length, header.length + 61);
			const block2 = inflatedString.substring(header.length +  61);

			expect(header).toBe("blob 97\0");
			console.log("header", header);

			expect(block1).toBe("Hi beautiful World, how you are doing on this beautiful World");
			console.log("block1", block1);
			
			expect(block2).toBe(", what a beautiful World to live on.");
			console.log("block2", block2);	

			// ---------------------------------------------------------------------------------------------------------------------------------------------------
			// 3. Create a ChunkBlockDeflator and push the header, then push block 1, then push block 2 with `Z_FULL_FLUSH`
			// ---------------------------------------------------------------------------------------------------------------------------------------------------


			const deflate = new ChunkBlockDeflate({ level: 6 });
			deflate.pushChunk(Buffer.from(header), "this-magic-parameter-comes-later");
			deflate.pushChunk(Buffer.from(block1), "this-magic-parameter-comes-later");
			deflate.pushChunk(Buffer.from(block2), "this-magic-parameter-comes-later", true);

			const deflationInfo = deflate.deflationInfo


			// ---------------------------------------------------------------------------------------------------------------------------------------------------
			// 4. Store the deflated result back into the blob
			// ---------------------------------------------------------------------------------------------------------------------------------------------------

			// remove the original blob file to make sure we are not just reading the same file again
			fs.unlinkSync(objectPath);

			// Write the block deflated blob
			fs.writeFileSync(objectPath, deflate.result);
			execSync(`chmod 444 "${objectPath}"`, { encoding: "utf-8" });

			// ---------------------------------------------------------------------------------------------------------------------------------------------------
			// 5. Check if git still reads the object
			// ---------------------------------------------------------------------------------------------------------------------------------------------------

			// Verify with git cat-file -p
			const catFileOutput = execSync(
				`git cat-file -p ${blobHash}`,
				{ encoding: "utf-8", cwd: tempDir }
			);

			expect(compressedData.length).not.toBe(deflate.result.length);
			const gitContent = Buffer.from(catFileOutput);
			const gitContentStr = gitContent.toString("utf-8");

			expect(gitContentStr).toBe("Hi beautiful World, how you are doing on this beautiful World, what a beautiful World to live on.");
			console.log("gitContentStr should be: 'Hi beautiful World, how you are doing on this beautiful World, what a beautiful World to live on.'\n", gitContentStr === 'Hi beautiful World, how you are doing on this beautiful World, what a beautiful World to live on.', '');

			// ---------------------------------------------------------------------------------------------------------------------------------------------------
			// 6. Read the deflated bytes from block 2 and inflate them independently
			// ---------------------------------------------------------------------------------------------------------------------------------------------------
			const objectFileHandle = fs.openSync(objectPath, 'r');
			const block2Deflated = new Uint8Array(deflationInfo.blocks[2]!.end - deflationInfo.blocks[2]!.start);
			fs.readSync(objectFileHandle, block2Deflated, 0, block2Deflated.length, deflationInfo.blocks[2]!.start);

			const inflatedBlock = BlockInflate.inflateBlockChunk(block2Deflated, {
				deflationInfo: deflationInfo ,
			});

			
			const block2DeflatedString = new TextDecoder().decode(inflatedBlock as Uint8Array)

			expect(block2DeflatedString).toBe(", what a beautiful World to live on.");
			console.log("block2DeflatedString should be: ', what a beautiful World to live on.'\n", block2DeflatedString === ', what a beautiful World to live on.', '');

		} finally {
			// Clean up temp directory
			execSync(`rm -rf "${tempDir}"`, { encoding: "utf-8" });
		}
	});

});

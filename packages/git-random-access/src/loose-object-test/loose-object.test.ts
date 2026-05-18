import { describe, it, expect } from "vitest";
import { execSync } from "child_process";
import { resolve } from "path";
import {
	mkdtempSync,
	readFileSync,
	unlinkSync,
	renameSync,
	existsSync,
	mkdirSync,
	writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { BlockDeflate } from "@talepack/zlib-random-access";
import { redeflateBlob } from "../native-git-util/redeflate-blob.js";
import { SHA1 } from "@oslojs/crypto/sha1";
import * as pako from "pako";

describe("loose object test", () => {
	it("should create a simple git blob and verify its content", () => {
		// Create a temp dir
		const tempDir = mkdtempSync(join(tmpdir(), "git-simple-test-"));

		try {
			// Create a git repo in it using init
			execSync(`git init "${tempDir}"`, { encoding: "utf-8", cwd: tempDir });

			// Create a readme containing "hello world"
			const readmePath = join(tempDir, "readme.md");
			writeFileSync(readmePath, "hello world");

			// Use git add to add the readme
			execSync(`git add readme.md`, { encoding: "utf-8", cwd: tempDir });

			// Use `git hash-object readme.md` to get the hash
			const hashOutput = execSync(`git hash-object readme.md`, {
				encoding: "utf-8",
				cwd: tempDir,
			}).trim();
			const blobHash = hashOutput;

			// Read the compressed blob file
			const objectPath = join(
				tempDir,
				".git",
				"objects",
				blobHash.slice(0, 2),
				blobHash.slice(2)
			);
			const compressedData = readFileSync(objectPath);

			// Use pako to inflate the blob file into a buffer
			const inflated = pako.inflate(compressedData);
			const inflatedString = Buffer.from(inflated).toString("utf-8");

			// Verify the content matches "blob 12\0hello world"
			// The format is: "blob <size>\0<content>"
			// "hello world" is 12 bytes
			expect(inflatedString).toBe("blob 11\0hello world");
		} finally {
			// Clean up temp directory
			execSync(`rm -rf "${tempDir}"`, { encoding: "utf-8" });
		}
	});

	it("should create a git blob using BlockDeflate and read it back with git", () => {
		const repoPath = resolve(__dirname, "../sample-repo");
		const blobHash = "97cf366007afaa83fc5ea0c49d3c6ad9361f0081";
		const blockSize = 4096; // 4KB blocks

		// Create a temporary file to avoid ENOBUFS with large buffers in execSync
		const tempDir = mkdtempSync(join(tmpdir(), "git-test-"));
		const tempFile = join(tempDir, "blob-output");
		const backupFile = join(tempDir, "blob-backup");

		try {
			// Step 1: Read the original blob using git cat-file
			execSync(
				`git -C "${repoPath}" cat-file -p ${blobHash} > "${tempFile}"`,
				{ encoding: "utf-8" }
			);
			const originalContent = readFileSync(tempFile);

			expect(originalContent).toBeInstanceOf(Buffer);
			expect(originalContent.length).toBe(30704510); // Known size

			// Step 2: Backup the original git loose object
			const objectPath = join(
				repoPath,
				".git",
				"objects",
				blobHash.slice(0, 2),
				blobHash.slice(2)
			);

			expect(existsSync(objectPath)).toBe(true);
			renameSync(objectPath, backupFile);

			// Step 3: Create a new git loose object manually using BlockDeflate

			// Git object format: "blob <size>\0<data>"
			const header = `blob ${originalContent.length}\0`;
			const headerBuffer = Buffer.from(header, "utf-8");

			// Combine header and content
			const fullContent = Buffer.concat([headerBuffer, originalContent]);

			// Create deflate with BlockDeflate
			const deflate = new BlockDeflate({
				level: 6, // Default git compression level
				blockSize,
				chunkSize: blockSize,
			});

			// Push the content in blocks - to avoid callstack issues (currently recursive implementation in BlockDeflate)
			let offset = 0;
			while (offset < fullContent.length) {
				const chunk = fullContent.subarray(offset, offset + blockSize);
				deflate.push(chunk);
				offset += blockSize;
			}

			// Finish compression
			deflate.push(Buffer.alloc(0), true);

			// Get the compressed data from chunks
			const compressedData = deflate.result;
			
			// Calculate SHA1 hash of the full content
			const hasher = new SHA1();
			hasher.update(fullContent);
			const digest = hasher.digest();
			const newHash = Array.from(digest)
				.map((byte) => byte.toString(16).padStart(2, "0"))
				.join("");

			// Verify the hash matches the original
			expect(newHash).toBe(blobHash);

			// Create the git object directory structure
			const objectDir = join(repoPath, ".git", "objects", newHash.slice(0, 2));
			if (!existsSync(objectDir)) {
				mkdirSync(objectDir, { recursive: true });
			}

			// Write the compressed object
			const newObjectPath = join(objectDir, newHash.slice(2));
			writeFileSync(newObjectPath, compressedData);

			// Set read-only permissions (git objects are read-only)
			execSync(`chmod 444 "${newObjectPath}"`, { encoding: "utf-8" });

			// Step 4: Read the new blob back using git cat-file
			const newOutputFile = join(tempDir, "new-blob-output");
			execSync(
				`git -C "${repoPath}" cat-file -p ${newHash} > "${newOutputFile}"`,
				{ encoding: "utf-8" }
			);
			const newContent = readFileSync(newOutputFile);

			// Step 5: Compare the original and new content
			expect(newContent).toBeInstanceOf(Buffer);
			expect(newContent.length).toBe(originalContent.length);
			expect(Buffer.compare(newContent, originalContent)).toBe(0);

			// Verify git recognizes the object type
			const typeOutput = execSync(
				`git -C "${repoPath}" cat-file -t ${newHash}`,
				{ encoding: "utf-8" }
			).trim();

			expect(typeOutput).toBe("blob");

			// Verify git sees the correct size
			const sizeOutput = execSync(
				`git -C "${repoPath}" cat-file -s ${newHash}`,
				{ encoding: "utf-8" }
			).trim();

			const size = parseInt(sizeOutput, 10);
			expect(size).toBe(originalContent.length);
		} finally {
			// Clean up: Restore the original blob
			const backupFile = join(tempDir, "blob-backup");
			const objectPath = join(
				repoPath,
				".git",
				"objects",
				blobHash.slice(0, 2),
				blobHash.slice(2)
			);

			if (existsSync(backupFile)) {
				// Remove the possibly-created object first
				if (existsSync(objectPath)) {
					unlinkSync(objectPath);
				}
				// Restore the original
				renameSync(backupFile, objectPath);
			}
		}
	});

	it("should redeflate a git blob in blocks, respecting the header", () => {
		const blockSize = 4096;

		// Create test data: 4096 A's, 4096 B's, through Z
		const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
		const testData = Buffer.alloc(letters.length * blockSize);
		for (let i = 0; i < letters.length; i++) {
			testData.fill(letters[i]!, i * blockSize, (i + 1) * blockSize);
		}

		// Step 1: Create a file with the data, add it to git, and get the hash
		const tempDir = mkdtempSync(join(tmpdir(), "git-redeflate-test-"));
		const testFilePath = join(tempDir, "test-data.bin");

		try {
			execSync(`git init "${tempDir}"`, { encoding: "utf-8", cwd: tempDir });
			writeFileSync(testFilePath, testData);
			execSync(`git add test-data.bin`, { encoding: "utf-8", cwd: tempDir });

			const hashOutput = execSync(`git hash-object test-data.bin`, {
				encoding: "utf-8",
				cwd: tempDir,
			}).trim();
			const blobHash = hashOutput;

			// Use the redeflateBlob function to re-encode the blob with proper block boundaries
			const redeflatedCompressed = redeflateBlob({
				gitPath: join(tempDir, ".git"),
				blobUid: blobHash,
				blockSize,
			});

			// Step 8: Save the resulting compressed data into a new git object and verify it with git cat-file -p and -t
			const objectPath = join(
				tempDir,
				".git",
				"objects",
				blobHash.slice(0, 2),
				blobHash.slice(2)
			);
			const backupPath = join(tempDir, "blob-backup");

			// Backup the original
			renameSync(objectPath, backupPath);

			// Write the redeflated blob
			writeFileSync(objectPath, redeflatedCompressed);
			execSync(`chmod 444 "${objectPath}"`, { encoding: "utf-8" });

			// Verify with git cat-file -p
			const catFileOutput = execSync(
				`git cat-file -p ${blobHash}`,
				{ encoding: "utf-8", cwd: tempDir }
			);
			const gitContent = Buffer.from(catFileOutput);

			expect(gitContent.length).toBe(testData.length);
			expect(Buffer.compare(gitContent, testData)).toBe(0);

			// Verify with git cat-file -t
			const typeOutput = execSync(
				`git cat-file -t ${blobHash}`,
				{ encoding: "utf-8", cwd: tempDir }
			).trim();

			expect(typeOutput).toBe("blob");
		} finally {
			// Clean up
			execSync(`rm -rf "${tempDir}"`, { encoding: "utf-8" });
		}
	});
});

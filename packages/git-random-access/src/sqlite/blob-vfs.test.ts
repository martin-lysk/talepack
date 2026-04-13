import { describe, it, expect, beforeAll } from "vitest";
import { mkdirSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { registerFSVFS } from "./fs-vfs.js";
import * as fs from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe("blog-vfs test", () => {
	let sqlite3: any;

	beforeAll(async () => {
		// Load the SQLite WASM module
		const sqlite3InitModule = (await import("@sqlite.org/sqlite-wasm")).default;
		sqlite3 = await sqlite3InitModule();

		// Register the FS VFS
		registerFSVFS(sqlite3, { fs, name: "node" });
	});

	it("should create a simple SQLite file with blog posts using FS VFS", async () => {
		const fixturePath = join(__dirname, "fixture", "blog-fs-vfs.sqlite");

		// Ensure the fixture directory exists
		const fixtureDir = dirname(fixturePath);
		mkdirSync(fixtureDir, { recursive: true });

		// Create database using our FS VFS
		const db = new sqlite3.oo1.DB(`file:${fixturePath}?vfs=node`);

		try {
			// Create a simple blog posts table
			db.exec(`
				CREATE TABLE posts (
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					title TEXT NOT NULL,
					content TEXT NOT NULL,
					author TEXT NOT NULL,
					created_at TEXT NOT NULL
				)
			`);

			// Insert dummy data
			const insert = db.prepare(
				"INSERT INTO posts (title, content, author, created_at) VALUES (?, ?, ?, ?)"
			);
			try {
				insert.bind(["First Post", "This is my first blog post!", "Alice", "2025-01-15T10:00:00Z"]);
				insert.step();
				insert.reset();

				insert.bind(["Second Post", "Another day, another post.", "Bob", "2025-01-16T14:30:00Z"]);
				insert.step();
				insert.reset();

				insert.bind(["Hello World", "Welcome to my blog about testing.", "Charlie", "2025-01-17T09:15:00Z"]);
				insert.step();
			} finally {
				insert.finalize();
			}

			// Verify the data was inserted
			const stmt = db.prepare("SELECT COUNT(*) as count FROM posts");
			try {
				stmt.step();
				const result = stmt.get({});
				expect(result.count).toBe(3);
			} finally {
				stmt.finalize();
			}

			console.log(`SQLite database created at: ${fixturePath}`);
		} finally {
			db.close();
		}

		// Verify the file was created on disk
		const stats = fs.statSync(fixturePath);
		expect(stats.size).toBeGreaterThan(0);
		console.log(`Database file size: ${stats.size} bytes`);

		// Verify we can reopen and read the database
		const db2 = new sqlite3.oo1.DB(`file:${fixturePath}?vfs=node`);
		try {
			const stmt = db2.prepare("SELECT title FROM posts ORDER BY id");
			try {
				const titles: string[] = [];
				while (stmt.step()) {
					titles.push(stmt.get({}).title);
				}

				expect(titles).toEqual(["First Post", "Second Post", "Hello World"]);
			} finally {
				stmt.finalize();
			}
		} finally {
			db2.close();
		}
	});

	it("should verify the created SQLite file has valid format", async () => {
		const fixturePath = join(__dirname, "fixture", "blog-fs-vfs.sqlite");
		const buffer = readFileSync(fixturePath);

		// Verify the file exists and has content
		expect(buffer.length).toBeGreaterThan(0);

		// Verify SQLite header (first 16 bytes should be "SQLite format 3\0")
		const header = buffer.subarray(0, 16).toString("utf-8");
		expect(header).toBe("SQLite format 3\0");

		// Verify the file size is reasonable (should be at least 1KB)
		expect(buffer.length).toBeGreaterThan(1024);

		console.log(`SQLite file verified: ${fixturePath}`);
		console.log(`File size: ${buffer.length} bytes`);
		console.log(`Header: ${header}`);
	});
});

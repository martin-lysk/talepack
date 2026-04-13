import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { memfs } from "memfs";
import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import { registerFSVFS, type FileSystem } from "./fs-vfs.js";
import * as fs from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdirSync } from "node:fs";

describe("FS VFS", () => {
	let sqlite3: any;

	beforeEach(async () => {
		const sqlite3InitModule = (await import("@sqlite.org/sqlite-wasm")).default;
		sqlite3 = await sqlite3InitModule();
	});

	describe("with memfs (in-memory filesystem)", () => {
		it("should create and query a database", () => {
			const { fs: memFs } = memfs();

			// Register VFS with memfs (cast to FileSystem interface)
			registerFSVFS(sqlite3, { fs: memFs as unknown as FileSystem, name: "mem" });

			// Create database in memory filesystem
			const db = new sqlite3.oo1.DB("file:/test.db?vfs=mem");

			try {
				// Create table
				db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");

				// Insert data
				const insert = db.prepare("INSERT INTO users (id, name) VALUES (?, ?)");
				try {
					insert.bind([1, "Alice"]);
					insert.step();
					insert.reset();

					insert.bind([2, "Bob"]);
					insert.step();
				} finally {
					insert.finalize();
				}

				// Query data
				const stmt = db.prepare("SELECT * FROM users ORDER BY id");
				try {
					const users: any[] = [];
					while (stmt.step()) {
						users.push(stmt.get({}));
					}

					expect(users.length).toBe(2);
					expect(users[0].name).toBe("Alice");
					expect(users[1].name).toBe("Bob");
				} finally {
					stmt.finalize();
				}

				// Verify file exists in memfs
				expect(memFs.existsSync("/test.db")).toBe(true);
			} finally {
				db.close();
			}
		});

		it("should persist data across database connections", () => {
			const { fs: memFs } = memfs();

			registerFSVFS(sqlite3, { fs: memFs as unknown as FileSystem, name: "mem" });

			// Create and write to database
			const db1 = new sqlite3.oo1.DB("file:/persist.db?vfs=mem");
			try {
				db1.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)");
				db1.exec("INSERT INTO settings VALUES ('theme', 'dark')");
			} finally {
				db1.close();
			}

			// Reopen database and verify data
			const db2 = new sqlite3.oo1.DB("file:/persist.db?vfs=mem");
			try {
				const stmt = db2.prepare("SELECT value FROM settings WHERE key = 'theme'");
				try {
					stmt.step();
					const result = stmt.get({});
					expect(result.value).toBe("dark");
				} finally {
					stmt.finalize();
				}
			} finally {
				db2.close();
			}
		});

		it("should handle multiple databases", () => {
			const { fs: memFs } = memfs();

			registerFSVFS(sqlite3, { fs: memFs as unknown as FileSystem, name: "mem" });

			// Create two databases
			const db1 = new sqlite3.oo1.DB("file:/db1.sqlite?vfs=mem");
			const db2 = new sqlite3.oo1.DB("file:/db2.sqlite?vfs=mem");

			try {
				db1.exec("CREATE TABLE items (id INTEGER, name TEXT)");
				db1.exec("INSERT INTO items VALUES (1, 'item1')");

				db2.exec("CREATE TABLE products (id INTEGER, price REAL)");
				db2.exec("INSERT INTO products VALUES (1, 9.99)");

				// Verify both databases work independently
				const stmt1 = db1.prepare("SELECT * FROM items");
				try {
					stmt1.step();
					expect(stmt1.get({}).name).toBe("item1");
				} finally {
					stmt1.finalize();
				}

				const stmt2 = db2.prepare("SELECT * FROM products");
				try {
					stmt2.step();
					expect(stmt2.get({}).price).toBe(9.99);
				} finally {
					stmt2.finalize();
				}

				// Verify both files exist
				expect(memFs.existsSync("/db1.sqlite")).toBe(true);
				expect(memFs.existsSync("/db2.sqlite")).toBe(true);
			} finally {
				db1.close();
				db2.close();
			}
		});
	});

	describe("with Node.js fs (real filesystem)", () => {
		let tempDir: string;

		beforeEach(() => {
			// Create temporary directory for each test
			tempDir = mkdtempSync(join(tmpdir(), "sqlite-fs-vfs-"));
		});

		afterEach(() => {
			// Cleanup temp directory
			if (tempDir) {
				try {
					rmSync(tempDir, { recursive: true, force: true });
				} catch (e) {
					// Ignore cleanup errors
				}
			}
		});

		it("should create and query a database on disk", () => {
			// Register VFS with Node.js fs
			registerFSVFS(sqlite3, { fs, name: "node" });

			const dbPath = join(tempDir, "test.db");
			const db = new sqlite3.oo1.DB(`file:${dbPath}?vfs=node`);

			try {
				// Create table and insert data
				db.exec("CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT)");
				db.exec("INSERT INTO posts VALUES (1, 'First Post')");
				db.exec("INSERT INTO posts VALUES (2, 'Second Post')");

				// Query data
				const stmt = db.prepare("SELECT * FROM posts ORDER BY id");
				try {
					const posts: any[] = [];
					while (stmt.step()) {
						posts.push(stmt.get({}));
					}

					expect(posts.length).toBe(2);
					expect(posts[0].title).toBe("First Post");
					expect(posts[1].title).toBe("Second Post");
				} finally {
					stmt.finalize();
				}

				// Verify file exists
				expect(fs.existsSync(dbPath)).toBe(true);
			} finally {
				db.close();
			}
		});

		it("should persist data across database connections", () => {
			registerFSVFS(sqlite3, { fs, name: "node" });

			const dbPath = join(tempDir, "persist.db");

			// Create and write to database
			const db1 = new sqlite3.oo1.DB(`file:${dbPath}?vfs=node`);
			try {
				db1.exec("CREATE TABLE config (key TEXT PRIMARY KEY, value TEXT)");
				db1.exec("INSERT INTO config VALUES ('debug', 'true')");
			} finally {
				db1.close();
			}

			// Reopen database and verify data
			const db2 = new sqlite3.oo1.DB(`file:${dbPath}?vfs=node`);
			try {
				const stmt = db2.prepare("SELECT value FROM config WHERE key = 'debug'");
				try {
					stmt.step();
					const result = stmt.get({});
					expect(result.value).toBe("true");
				} finally {
					stmt.finalize();
				}
			} finally {
				db2.close();
			}
		});

		it("should work with existing blog database", () => {
			registerFSVFS(sqlite3, { fs, name: "node" });

			const dbPath = join(tempDir, "blog.db");
			const db = new sqlite3.oo1.DB(`file:${dbPath}?vfs=node`);

			try {
				// Create blog schema
				db.exec(`
					CREATE TABLE posts (
						id INTEGER PRIMARY KEY AUTOINCREMENT,
						title TEXT NOT NULL,
						content TEXT NOT NULL,
						author TEXT NOT NULL,
						created_at TEXT NOT NULL
					)
				`);

				// Insert blog posts
				const insert = db.prepare(
					"INSERT INTO posts (title, content, author, created_at) VALUES (?, ?, ?, ?)"
				);
				try {
					insert.bind(["Hello World", "My first post!", "Alice", "2025-01-15T10:00:00Z"]);
					insert.step();
					insert.reset();

					insert.bind([
						"Second Post",
						"More content here",
						"Bob",
						"2025-01-16T14:30:00Z",
					]);
					insert.step();
				} finally {
					insert.finalize();
				}

				// Query with different orderings
				const stmt = db.prepare("SELECT * FROM posts ORDER BY created_at DESC");
				try {
					const posts: any[] = [];
					while (stmt.step()) {
						posts.push(stmt.get({}));
					}

					expect(posts.length).toBe(2);
					expect(posts[0].author).toBe("Bob");
					expect(posts[1].author).toBe("Alice");
				} finally {
					stmt.finalize();
				}

				// Verify file exists and has content
				expect(fs.existsSync(dbPath)).toBe(true);
				const stats = fs.statSync(dbPath);
				expect(stats.size).toBeGreaterThan(0);
			} finally {
				db.close();
			}
		});

		it("should handle database in subdirectory", () => {
			registerFSVFS(sqlite3, { fs, name: "node" });

			const subDir = join(tempDir, "subdir", "nested");
			mkdirSync(subDir, { recursive: true });

			const dbPath = join(subDir, "nested.db");
			const db = new sqlite3.oo1.DB(`file:${dbPath}?vfs=node`);

			try {
				db.exec("CREATE TABLE test (id INTEGER)");
				db.exec("INSERT INTO test VALUES (1)");

				const stmt = db.prepare("SELECT * FROM test");
				try {
					stmt.step();
					expect(stmt.get({}).id).toBe(1);
				} finally {
					stmt.finalize();
				}

				expect(fs.existsSync(dbPath)).toBe(true);
			} finally {
				db.close();
			}
		});
	});

	describe("error handling", () => {
		it("should handle opening non-existent file in read-only mode", () => {
			const { fs: memFs } = memfs();

			registerFSVFS(sqlite3, { fs: memFs as unknown as FileSystem, name: "mem" });

			// Try to open non-existent file
			expect(() => {
				new sqlite3.oo1.DB("file:/nonexistent.db?vfs=mem&mode=ro");
			}).toThrow();
		});

		it("should handle file operations on closed database", () => {
			const { fs: memFs } = memfs();

			registerFSVFS(sqlite3, { fs: memFs as unknown as FileSystem, name: "mem" });

			const db = new sqlite3.oo1.DB("file:/test.db?vfs=mem");
			db.exec("CREATE TABLE test (id INTEGER)");
			db.close();

			// Try to use closed database
			expect(() => {
				db.exec("INSERT INTO test VALUES (1)");
			}).toThrow();
		});
	});
});

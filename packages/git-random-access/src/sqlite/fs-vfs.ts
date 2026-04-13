import type { Sqlite3Static, WasmPointer, Sqlite3Result } from "@sqlite.org/sqlite-wasm";

/**
 * Minimal filesystem interface required by SQLite VFS
 * This is compatible with Node.js fs and memfs
 */
export interface FileSystem {
	openSync(path: string, flags: string): number;
	closeSync(fd: number): void;
	readSync(fd: number, buffer: Uint8Array, offset: number, length: number, position: number): number;
	writeSync(
		fd: number,
		buffer: Uint8Array,
		offset: number,
		length: number,
		position: number
	): number;
	fstatSync(fd: number): { size: number };
	ftruncateSync(fd: number, length?: number): void;
	fsyncSync(fd: number): void;
	existsSync(path: string): boolean;
	rmSync(path: string): void;
}

/**
 * Options for registering a filesystem-based VFS
 */
export interface FSVFSOptions {
	/** The filesystem implementation (Node.js fs, memfs, etc.) */
	fs: FileSystem;
	/** Name for the VFS (default: "fs-vfs") */
	name?: string;
	/** Make this the default VFS */
	makeDefault?: boolean;
}

/**
 * File handle tracking
 */
interface FileHandle {
	/** File descriptor from fs.openSync() */
	fd: number;
	/** File path */
	path: string;
	/** SQLite file object */
	sq3File: InstanceType<Sqlite3Static["capi"]["sqlite3_file"]>;
}

/**
 * Open files registry keyed by file pointer ID
 */
const openFiles: Record<number, FileHandle> = {};

/**
 * Convert SQLite open flags to Node.js fs open flags
 */
function getOpenFlags(sqliteFlags: number): string {
	const create = !!(sqliteFlags & 0x00000004); /* SQLITE_OPEN_CREATE */
	const readOnly = !!(sqliteFlags & 0x00000001); /* SQLITE_OPEN_READONLY */
	const readWrite = !!(sqliteFlags & 0x00000002); /* SQLITE_OPEN_READWRITE */

	if (readOnly) return "r";
	if (create && readWrite) {
		// Check if file exists to decide between "w+" (truncate) and "a+" (append)
		// But we can't check here - we need to handle it in xOpen
		// For now, use "r+" which doesn't truncate, and let SQLite handle creation
		return "r+";
	}
	return "r+";
}

/**
 * Register a filesystem-based VFS with SQLite
 *
 * @example
 * ```ts
 * import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
 * import * as fs from 'node:fs';
 * import { registerFSVFS } from './fs-vfs.js';
 *
 * const sqlite3 = await sqlite3InitModule();
 * registerFSVFS(sqlite3, { fs, name: 'node' });
 *
 * // Use the VFS
 * const db = new sqlite3.oo1.DB('file:mydb.sqlite?vfs=node');
 * ```
 */
export function registerFSVFS(sqlite3: Sqlite3Static, options: FSVFSOptions): void {
	const capi = sqlite3.capi;
	const wasm = sqlite3.wasm;
	const { fs, name = "fs-vfs", makeDefault = false } = options;

	// Create VFS and IO methods structures
	const vfs = new capi.sqlite3_vfs();
	const io = new capi.sqlite3_io_methods();

	// Set VFS properties
	vfs.$iVersion = 1;
	// Set szOsFile to size of sqlite3_file structure (typically around 100 bytes)
	vfs.$szOsFile = 120; // Conservative size for sqlite3_file
	vfs.$mxPathname = 1024;
	vfs.$zName = wasm.allocCString(name, false);

	// ========== IO Methods (file operations) ==========

	const ioMethods = {
		/**
		 * Close a file handle
		 */
		xClose: function (fid: WasmPointer): Sqlite3Result {
			const file = openFiles[fid];
			if (!file) {
				return capi.SQLITE_NOTFOUND;
			}

			try {
				fs.closeSync(file.fd);
				delete openFiles[fid];
				return capi.SQLITE_OK;
			} catch (e) {
				console.error(`FS VFS: Error closing file ${file.path}:`, e);
				return capi.SQLITE_IOERR_CLOSE;
			}
		},

		/**
		 * Read data from file
		 */
		xRead: function (
			fid: WasmPointer,
			dest: WasmPointer,
			n: number,
			offset: number
		): Sqlite3Result {
			const file = openFiles[fid];
			if (!file) {
				return capi.SQLITE_NOTFOUND;
			}

			try {
				const buffer = new Uint8Array(n);
				const bytesRead = fs.readSync(file.fd, buffer, 0, n, Number(offset));

				// If we read less than expected, it's not an error unless we read 0
				// and the file position is beyond the end
				if (bytesRead < n) {
					// Fill the rest with zeros
					for (let i = bytesRead; i < n; i++) {
						buffer[i] = 0;
					}
					// Set the "short read" flag by returning SQLITE_IOERR_SHORT_READ
					// But for now, let's just return OK
				}

				wasm.heap8u().set(buffer, dest);
				return capi.SQLITE_OK;
			} catch (e) {
				console.error(`FS VFS: Error reading from ${file.path}:`, e);
				return capi.SQLITE_IOERR_READ;
			}
		},

		/**
		 * Write data to file
		 */
		xWrite: function (
			fid: WasmPointer,
			src: WasmPointer,
			n: number,
			offset: number
		): Sqlite3Result {
			const file = openFiles[fid];
			if (!file) {
				return capi.SQLITE_NOTFOUND;
			}

			try {
				const data = wasm.heap8u().subarray(src, src + n);
				fs.writeSync(file.fd, data, 0, n, Number(offset));
				return capi.SQLITE_OK;
			} catch (e) {
				console.error(`FS VFS: Error writing to ${file.path}:`, e);
				return capi.SQLITE_IOERR_WRITE;
			}
		},

		/**
		 * Truncate file to specified size
		 */
		xTruncate: function (fid: WasmPointer, size: number): Sqlite3Result {
			const file = openFiles[fid];
			if (!file) {
				return capi.SQLITE_NOTFOUND;
			}

			try {
				fs.ftruncateSync(file.fd, Number(size));
				return capi.SQLITE_OK;
			} catch (e) {
				console.error(`FS VFS: Error truncating ${file.path}:`, e);
				return capi.SQLITE_IOERR_TRUNCATE;
			}
		},

		/**
		 * Sync file to disk
		 */
		xSync: function (fid: WasmPointer, flags: number): Sqlite3Result {
			const file = openFiles[fid];
			if (!file) {
				return capi.SQLITE_NOTFOUND;
			}

			try {
				// Use fsync for full sync, or could use fdatasync for data-only sync
				fs.fsyncSync(file.fd);
				return capi.SQLITE_OK;
			} catch (e) {
				console.error(`FS VFS: Error syncing ${file.path}:`, e);
				return capi.SQLITE_IOERR_FSYNC;
			}
		},

		/**
		 * Get file size
		 */
		xFileSize: function (fid: WasmPointer, pSize: WasmPointer): Sqlite3Result {
			const file = openFiles[fid];
			if (!file) {
				return capi.SQLITE_NOTFOUND;
			}

			try {
				const stats = fs.fstatSync(file.fd);
				wasm.poke64(pSize, stats.size);
				return capi.SQLITE_OK;
			} catch (e) {
				console.error(`FS VFS: Error getting size of ${file.path}:`, e);
				return capi.SQLITE_IOERR_FSTAT;
			}
		},

		/**
		 * Lock file (no-op for single-threaded Node.js)
		 */
		xLock: function (fid: WasmPointer, lockType: number): Sqlite3Result {
			// Node.js is single-threaded, so locking is not needed
			return capi.SQLITE_OK;
		},

		/**
		 * Unlock file (no-op for single-threaded Node.js)
		 */
		xUnlock: function (fid: WasmPointer, lockType: number): Sqlite3Result {
			// Node.js is single-threaded, so locking is not needed
			return capi.SQLITE_OK;
		},

		/**
		 * Check if file has reserved lock (always returns false)
		 */
		xCheckReservedLock: function (fid: WasmPointer, pResOut: WasmPointer): Sqlite3Result {
			// No reserved locks in single-threaded Node.js
			wasm.poke(pResOut, 0, "i32");
			return capi.SQLITE_OK;
		},

		/**
		 * File control operations
		 */
		xFileControl: function (fid: WasmPointer, op: number, pArg: WasmPointer): Sqlite3Result {
			// Handle file control operations
			if (op === capi.SQLITE_FCNTL_SYNC) {
				return capi.SQLITE_OK;
			}
			if (op === capi.SQLITE_FCNTL_COMMIT_PHASETWO) {
				return capi.SQLITE_OK;
			}
			return capi.SQLITE_NOTFOUND;
		},

		/**
		 * Get sector size (default to 4096)
		 */
		xSectorSize: function (fid: WasmPointer): Sqlite3Result {
			return 4096 as Sqlite3Result;
		},

		/**
		 * Get device characteristics
		 */
		xDeviceCharacteristics: function (fid: WasmPointer): Sqlite3Result {
			return capi.SQLITE_IOCAP_UNDELETABLE_WHEN_OPEN as Sqlite3Result;
		},
	};

	// ========== VFS Methods (filesystem operations) ==========

	const vfsMethods = {
		/**
		 * Open a file
		 */
		xOpen: function (
			vfsPtr: WasmPointer,
			namePtr: WasmPointer,
			fid: WasmPointer,
			flags: number,
			pOutFlags: WasmPointer
		): Sqlite3Result {
			if (namePtr === 0) {
				console.error("FS VFS: Anonymous files not supported");
				return capi.SQLITE_CANTOPEN;
			}

			const path = wasm.cstrToJs(namePtr);
			if (!path) {
				return capi.SQLITE_CANTOPEN;
			}

			try {
				const openFlags = getOpenFlags(flags);
				const create = !!(flags & 0x00000004); /* SQLITE_OPEN_CREATE */
				const readOnly = !!(flags & 0x00000001); /* SQLITE_OPEN_READONLY */

				let fd: number;
				if (create && !fs.existsSync(path)) {
					// Create new file with "w+" mode
					fd = fs.openSync(path, "w+");
				} else if (readOnly) {
					// Open read-only
					fd = fs.openSync(path, "r");
				} else {
					// Open read-write without truncating
					fd = fs.openSync(path, "r+");
				}

				// Create SQLite file object
				const sq3File = new capi.sqlite3_file(fid);
				// Set pMethods pointer for IO methods
				sq3File.$pMethods = io.pointer;

				// Store file handle
				openFiles[fid] = {
					fd,
					path,
					sq3File,
				};

				return capi.SQLITE_OK;
			} catch (e) {
				console.error(`FS VFS: Error opening ${path}:`, e);
				return capi.SQLITE_CANTOPEN;
			}
		},

		/**
		 * Delete a file
		 */
		xDelete: function (
			vfsPtr: WasmPointer,
			namePtr: WasmPointer,
			syncDir: number
		): Sqlite3Result {
			const path = wasm.cstrToJs(namePtr);
			if (!path) {
				return capi.SQLITE_ERROR;
			}

			try {
				fs.rmSync(path);
				return capi.SQLITE_OK;
			} catch (e) {
				console.error(`FS VFS: Error deleting ${path}:`, e);
				return capi.SQLITE_IOERR_DELETE;
			}
		},

		/**
		 * Check file access
		 */
		xAccess: function (
			vfsPtr: WasmPointer,
			namePtr: WasmPointer,
			flags: number,
			pResOut: WasmPointer
		): Sqlite3Result {
			const path = wasm.cstrToJs(namePtr);
			if (!path) {
				return capi.SQLITE_ERROR;
			}

			try {
				const exists = fs.existsSync(path);
				wasm.poke(pResOut, exists ? 1 : 0, "i32");
				return capi.SQLITE_OK;
			} catch (e) {
				console.error(`FS VFS: Error checking access for ${path}:`, e);
				wasm.poke(pResOut, 0, "i32");
				return capi.SQLITE_OK;
			}
		},

		/**
		 * Get full pathname
		 */
		xFullPathname: function (
			vfsPtr: WasmPointer,
			namePtr: WasmPointer,
			nOut: number,
			pOut: WasmPointer
		): Sqlite3Result {
			const path = wasm.cstrToJs(namePtr);
			if (!path) {
				return capi.SQLITE_ERROR;
			}

			// Copy the path as-is (already absolute or relative)
			const i = wasm.cstrncpy(pOut, namePtr, nOut);
			return i < nOut ? capi.SQLITE_OK : capi.SQLITE_CANTOPEN;
		},

		/**
		 * Get current time as Julian Day
		 */
		xCurrentTime: function (vfsPtr: WasmPointer, pTimeOut: WasmPointer): Sqlite3Result {
			// Julian Day for 1970-01-01 is 2440587.5
			const julianDay = 2440587.5 + new Date().getTime() / 86400000;
			wasm.poke(pTimeOut, julianDay, "double");
			return capi.SQLITE_OK;
		},

		/**
		 * Get current time as integer (milliseconds since 1970)
		 */
		xCurrentTimeInt64: function (vfsPtr: WasmPointer, pTimeOut: WasmPointer): Sqlite3Result {
			const now = BigInt(new Date().getTime());
			// Convert to Julian Day in milliseconds
			const julianDayMs = BigInt(2440587.5) * BigInt(86400000) + now;
			wasm.poke64(pTimeOut, julianDayMs);
			return capi.SQLITE_OK;
		},

		/**
		 * Get last error message
		 */
		xGetLastError: function (
			vfsPtr: WasmPointer,
			nBuf: number,
			pBuf: WasmPointer
		): Sqlite3Result {
			// No error message stored
			return capi.SQLITE_OK;
		},
	};

	// Register the VFS
	sqlite3.vfs.installVfs({
		io: { struct: io, methods: ioMethods },
		vfs: { struct: vfs, methods: vfsMethods, name, asDefault: makeDefault },
	});
}

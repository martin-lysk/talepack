import * as pako from "pako";

// @ts-expect-error -- inflate is private
import * as zlib_inflate from "pako/lib/zlib/inflate";

import {
	Z_OK,
	Z_STREAM_END,
	Z_NEED_DICT,
	Z_STREAM_ERROR,
	Z_DATA_ERROR,
	Z_MEM_ERROR,
	// @ts-expect-error -- constants is private
} from "pako/lib/zlib/constants";
import type { Hash } from "@oslojs/crypto/hash";

export class SeekInflate extends pako.Inflate {
	inputChunkSize: number;
	inflatedWindowSize: number;
	outputWindow: Uint8Array;

	reader: (buffer: Uint8Array, start: number, end: number) => number;
	readerPos = 0;
	deflatedBytes = 0;

	ended: boolean = false;

	currentInflatedStart: number = -1;
	currentInflatedEnd: number = -1;

	inflatedHasher: Hash | undefined;
	inflatedHasherPosition = 0;

	onChunkDeflated: ((buffer: Uint8Array, position: number) => void) | undefined;

	constructor(
		options: pako.InflateOptions & {
			inputChunkSize: number;
			reader: (buffer: Uint8Array, start: number, end: number) => number;
			onChunkDeflated?: (buffer: Uint8Array, position: number) => void;
			inflatedHasher?: Hash;
		}
	) {
		super(options);

		this.inputChunkSize = options.inputChunkSize;
		this.reader = options.reader;
		this.inflatedWindowSize = this.inputChunkSize * 258; // this was an estimate of the max inflation factor
		this.outputWindow = new Uint8Array(this.inflatedWindowSize);
		this.onChunkDeflated = options.onChunkDeflated;
		if (options.inflatedHasher) {
			this.inflatedHasher = options.inflatedHasher;
		}
	}

	/**
	 *
	 * @param buffer the Uint8Array to inflate the data into
	 * @param inflatedPosition the start position of the part to inflate into the buffer
	 * @param inflatedLength the number of bytes to inflate into the buffer
	 * @param flush_mode
	 * @returns the number of bytes inflated
	 */
	inflateRange(
		buffer: Uint8Array,
		inflatedPosition: number,
		inflatedLength: number,
		flush_mode: number | boolean = false
	): number {
		// console.log("inflateRange", { inflatedPosition, inflatedLength })
		const end = inflatedPosition + inflatedLength;
		// @ts-expect-error -- strm is private
		const strm = this.strm;

		strm.output = this.outputWindow;

		let _flush_mode;

		// if (this.ended) return 0

		if (flush_mode === ~~flush_mode) _flush_mode = flush_mode;
		else
			_flush_mode =
				flush_mode === true
					? pako.constants.Z_FINISH
					: pako.constants.Z_NO_FLUSH;

		if (inflatedPosition < this.currentInflatedStart) {
			// cursor before inflated window start
			//       |----|     <-- requested range
			//                  |---|  <- inflated window (restart would be reauired)
			// TODO reset inflator state
			throw new Error(
				"cursor after start ... only one direction reads supported"
			);
		}

		// here we can asume:
		// start >= this.inflatedWindowStart -> impliced by previous condition
		//          |--....     <-- requested range
		//     |--....  <- inflated window

		let lastWindow = false;

		while (this.currentInflatedEnd - 1 < inflatedPosition) {
			// console.log("the current window doesn't overlap with the requested range - forward ->>")
			// console.log("inflateRange", { currentInflatedEnd: this.currentInflatedEnd, inflatedPosition })
			// the current window doesnt overlap with the requested window -> forward till it overlaps
			//                 |--|     <-- requested range
			//     |--------|        <- inflated window

			if (lastWindow) {
				// console.log("returning - last window");
				return 0;
			}
			// console.log("fillNextWindowBuffer");

			// console.log("fill next window")
			// TODO make function more pure by returning the values modified by this function
			lastWindow = this.fillNextWindowBuffer(_flush_mode);

			// console.log(
			// 	"forwarding window" +
			// 		this.currentInflatedEnd +
			// 		" inflatedPosition " +
			// 		inflatedPosition
			// );
			if (this.currentInflatedEnd - 1 < inflatedPosition) {
				// the inflated window is not of interest - just update the hash function
				if (this.inflatedHasher !== undefined) {
					// console.log(
					// 	"output part",
					// 	new TextDecoder().decode(this.outputWindow)
					// );
					let useInflatedWindow = this.outputWindow;
					if (
						this.currentInflatedEnd - this.currentInflatedStart <
						this.outputWindow.length
					) {
						useInflatedWindow = this.outputWindow.subarray(
							0,
							this.currentInflatedEnd - this.currentInflatedStart
						);
					}
					// console.log("UPDATING HASH 2");
					this.inflatedHasher.update(useInflatedWindow);
					this.inflatedHasherPosition += useInflatedWindow.length;
				}
			} else {
				// console.log("forwarding window - but not updating hash");
			}
		}

		// ok lets check if the current window is sufficient or has parts that are usefull
		// console.log("match?");
		if (end <= this.currentInflatedEnd) {
			// console.log("match!...");
			// the current inflated window is already sufficient for the requested range
			//          |--|     <-- requested range
			//     |--------|    <- inflated window

			// compute the offset within the current window
			const startInInflateWindow = inflatedPosition - this.currentInflatedStart;
			const endInInflateWindow = startInInflateWindow + inflatedLength;

			// console.log("Reading needed bytes from curr sufficient window\n", {
			// 	from: inflatedPosition,
			// 	toMax: end,
			// 	maxLength: inflatedLength,
			// 	"------": ".-------",
			// 	windowStart: this.currentInflatedStart,
			// 	windowEnd: this.currentInflatedEnd,
			// 	// availableBytes,
			// 	"-----": "------",
			// 	startInInflateWindow,
			// 	endInInflateWindow,
			// 	// bytesToRead,
			// })

			// console.log("this.inflatedHasherPosition", this.inflatedHasherPosition);

			const result = this.outputWindow.subarray(
				startInInflateWindow,
				endInInflateWindow
			);
			// console.log("RESULT FROM CURRENT WINDOW: \n", result, "\n")

			const toHash = this.outputWindow.subarray(
				this.inflatedHasherPosition,
				endInInflateWindow
			);
			this.inflatedHasher?.update(toHash);
			// this.inflatedHasher?.update(new Uint8Array(1))

			// console.log(
			// 	"UPDATING HASH 3",
			// 	"\n!!!" +
			// 		// new TextDecoder().decode(
			// 		// 	this.outputWindow.subarray(this.inflatedHasherPosition, endInInflateWindow)
			// 		// ) +
			// 		toHash.length,
			// 	"!\n"
			// );

			this.inflatedHasherPosition += toHash.length;

			buffer.set(result, 0);
			return result.length;
		}

		let bytesInflated = 0;

		let nextPosition = inflatedPosition;

		while (this.currentInflatedStart < end) {
			// possible states
			//            |----|     <-- requested range
			//     |--------|    <- inflated window
			// or
			//            |----|     <-- requested range ? is covered eralier righzt
			//    	    |--------|    <- inflated window
			// or
			//            |----|     <-- requested range
			//    			|--------|    <- inflated window
			const availableBytes = this.currentInflatedEnd - nextPosition + 1;

			const bytesNeeded = inflatedLength - bytesInflated;
			const bytesToRead = Math.min(bytesNeeded, availableBytes);

			const startInInflateWindow = nextPosition - this.currentInflatedStart;
			const endInInflateWindow =
				availableBytes > bytesNeeded
					? startInInflateWindow + bytesToRead
					: startInInflateWindow + bytesToRead - 1;

			// console.log(
			// 	"Reading needed bytes from current window\n",
			// 	{
			// 		bytesInflatedBefore: bytesInflated,
			// 		from: nextPosition,
			// 		toMax: end,
			// 		maxLength: bytesNeeded,
			// 		"------": ".-------",
			// 		windowStart: this.currentInflatedStart,
			// 		windowEnd: this.currentInflatedEnd,
			// 		availableBytes,
			// 		"-----": "------",
			// 		startInInflateWindow,
			// 		endInInflateWindow,
			// 		bytesToRead,
			// 	},
			// 	this.currentInflatedEnd
			// )
			const readFromWindow = this.outputWindow.subarray(
				startInInflateWindow,
				endInInflateWindow
			);

			// console.log("UPDATING HASH with the current inflated window")
			let useInflatedWindow = this.outputWindow;
			if (
				this.currentInflatedEnd - this.currentInflatedStart <
				this.outputWindow.length
			) {
				useInflatedWindow = this.outputWindow.subarray(
					0,
					this.currentInflatedEnd - this.currentInflatedStart
				);
				// console.log("using just parts!!!!!!!!!!!!!!!!!!!!!!!!");
				// console.log(new TextDecoder().decode(useInflatedWindow))
			} else {
				// console.log("using the whole chunk!!!!!!!!!!!!!!!!!!!!!!!!");
			}
			// console.log("UPDATING HASH with leading content")
			// console.log("UPDATING HASH with leading content")
			// console.log("UPDATING HASH with leading content")

			// console.log("UPDATING HASH 1 with leading content");
			this.inflatedHasher?.update(useInflatedWindow);
			this.inflatedHasherPosition += useInflatedWindow.length;

			// console.log(
			// 	"\n READ FROM CURRENT WINDOW: \n" +
			// 		new TextDecoder().decode(readFromWindow as Uint8Array) +
			// 		"\n"
			// )

			buffer.set(readFromWindow, bytesInflated);

			bytesInflated += readFromWindow.length;

			// nextPosition = inflatedPosition + readFromWindow.length
			nextPosition = nextPosition + readFromWindow.length;

			// read the first chunk
			if (lastWindow) {
				break;
			}
			lastWindow = this.fillNextWindowBuffer(_flush_mode);
		}

		// console.log("\n RESULT: \n" + new TextDecoder().decode(buffer as Uint8Array) + "\n")

		return bytesInflated;
	}

	fillNextWindowBuffer(flush_mode: number): boolean {
		// @ts-expect-error -- strm is private
		const strm = this.strm;
		let status;
		// @ts-expect-error -- dictionary is private
		const dictionary = this.options.dictionary;
		strm.input = new Uint8Array(this.inputChunkSize);

		const bytesRead = this.reader(
			strm.input,
			this.readerPos,
			this.readerPos + this.inputChunkSize
		);

		if (bytesRead === 0) {
			// finished - last chunk was the last one
			// console.log("finished - last chunk was the last one")
			return true;
		} else if (bytesRead < this.inputChunkSize) {
			// this chunk is the last one!
			// console.log("this chunk is the last one")
		}

		// reset the window position:
		strm.next_out = 0;
		strm.avail_out = this.outputWindow.length;

		// set the window start (the last end +1, also for the first window!)
		if (this.currentInflatedEnd === -1) {
			this.currentInflatedEnd = 0;
		}
		this.currentInflatedStart = this.currentInflatedEnd;
		const windowReadStart = this.currentInflatedEnd;

		strm.next_in = 0;
		strm.avail_in = bytesRead;

		for (;;) {
			if (strm.avail_out === 0) {
				console.log("NOT ENOUGH SPACE?????");
				// strm.output = this.outputWindow
				strm.next_out = 0;
				strm.avail_out = this.outputWindow.length;
			}

			status = zlib_inflate.inflate(strm, flush_mode);

			if (status === Z_NEED_DICT && dictionary) {
				status = zlib_inflate.inflateSetDictionary(strm, dictionary);

				if (status === Z_OK) {
					status = zlib_inflate.inflate(strm, flush_mode);
				} else if (status === Z_DATA_ERROR) {
					// Replace code with more verbose
					status = Z_NEED_DICT;
				}
			}

			// Skip snyc markers if more data follows and not raw mode
			while (
				strm.avail_in > 0 &&
				status === Z_STREAM_END &&
				strm.state.wrap > 0 &&
				strm.input[strm.next_in] !== 0
			) {
				zlib_inflate.inflateReset(strm);
				status = zlib_inflate.inflate(strm, flush_mode);
			}

			// console.log("\nCURRENT WINDOW")
			// console.log(new TextDecoder().decode(strm.output as Uint8Array))
			// console.log()

			this.readerPos += bytesRead;
			switch (status) {
				case Z_STREAM_ERROR:
				case Z_DATA_ERROR:
				case Z_NEED_DICT:
				case Z_MEM_ERROR:
					this.onEnd(status);
					this.ended = true;

					// console.log("UNEXPECTED END");
					// last byte let to a crash....

					if (this.onChunkDeflated !== undefined) {
						this.onChunkDeflated(
							strm.input.subarray(0, strm.next_in - 2),
							this.deflatedBytes
						);
					}

					this.deflatedBytes += strm.next_in - 1;
					this.currentInflatedEnd = windowReadStart + strm.next_out;

					// console.log(
					// 	"UPDATING HASH!!!????",
					// 	new TextDecoder().decode(this.outputWindow)
					// );
					// this.inflatedHasher?.update(this.outputWindow.subarray(0, this.currentInflatedEnd))

					return true;
			}

			// console.log(
			// 	"this.deflatedBytes " +
			// 		this.deflatedBytes +
			// 		" nextIN " +
			// 		strm.next_in +
			// 		" input lenght  " +
			// 		strm.input.length
			// )

			let deflatedByteArray = strm.input;
			if (strm.input.length > strm.next_in) {
				deflatedByteArray = strm.input.subarray(0, strm.next_in);
			}

			if (this.onChunkDeflated !== undefined) {
				this.onChunkDeflated(deflatedByteArray, this.deflatedBytes);
			}

			this.deflatedBytes += strm.next_in;
			if (strm.next_out) {
				this.currentInflatedEnd = windowReadStart + strm.next_out;
			}

			// Must repeat iteration if out buffer is full
			if (status === Z_OK && strm.avail_out === 0) {
				// console.log("window is full?????");
				continue;
			}

			// Finalize if end of stream reached.
			if (status === Z_STREAM_END) {
				status = zlib_inflate.inflateEnd(strm);

				// @ts-expect-error -- strm is private
				this.deflatedBytes = this.strm.total_in;

				// @ts-expect-error -- strm is private
				if (this.deflatedBytes !== this.strm.total_in) {
					throw new Error(
						"this.deflatedBytes !== this.strm.total_in CHECK CRC computation!" +
							this.deflatedBytes,
						// @ts-expect-error -- strm is private
						this.strm.total_in
					);
				}

				this.onEnd(status);
				// console.log("END REACHED!")
				this.ended = true;
				return true;
			}

			if (strm.avail_in === 0) break;
		}

		return false;
	}
}

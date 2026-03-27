import { describe, it, expect } from "vitest"

import { buf as crc32 } from "crc-32"
import { fs as memfs } from "memfs"
import pako from "pako"

import { SeekInflate } from "./SeekInflate.js"
import { sha1, SHA1 } from "@oslojs/crypto/sha1"

const fs: any = memfs as unknown as any

const inflatedRandomNoiseBlocks = [
	"nVgNmJujXIGDPuoAeXoYBTiZLMmCwhuTEM6ZGO23J6aEqBJDeFlVEceTRwYH0vk7eYZ1GbthsKaZtOAXDsdcjwbaFOIrV0lrItEzzc2CfvObHhwTSswgqkGmKIGBMWD84P70pixEzUlvoK7HLcDS4qBmzEUGKGdnBbWQFMXJRGoeMIW8aTclSLFCmEF5HcOBksqVB91Y1OTFBTKWVk3CFVtXCrzy0uwrRRRsNOWXXtLtsr8YWZZm9L5rXiwtZkinMEEOQPIJCZo8Tl9u63VqH7OAKTcJyHX2LjVV7zxizigsLVdAKCT3lj61CbkcY2bFZVqL6nxPBR4woLNOZ6GId8tVZaD9k7b29hdyLS0b6My22Rs6caoR0b7rKxpr6PDo6zxN0r7O9GBpS1dzpvN1Ge5a5IhyR5WoC1iSwqxiNpbeXBOtGoNthi7DtljpbIPNqhq5sH6hyxjdQQVN9SNQtlTHpt7YwOQRgAj3QhTakP4cj98TkPwnC95X4zNU175C",
	"E8mwJr5OWGbUvSG4BGkE6EkIlpCcXjOgqOEsQOzQMBVcBmcTtwF6O4W9DAAdL0XFXDQHkcnesQ8qYQqYm1G22Q5KxHVMGKgpQRDxO1ieyiRusMwYqoeRBHkz7TzBuEhABJI0ZOra5GIYypOGB70ufTFKD72TOAaw6Lg0BEJqTSfvX9JG6sNaUMwSAIpO0w7XG6aXYL5Tn21A5LZr4qsjMGD8fJ7Uhhs6lRCkzirDkj4arBCUmdPYKqDIJFsi0BBVkjOcM6yG7yUArqRJouuzzBtOlRJEPSzdJH7SA2D1uVNh52ZTzNDXhdRzY68j7CyJpXfAdqCEjmZZyEKauYE96G9N7jCutspd6eKkOrjZHHYFnHSX9LTtQ9N8yl466PvTwhqIgnUaGCb68Av5hRgtJFzLaCmM9k0e89FqoLo42Jv1PZYp7QGGOng76M1uI8TgJAR31yhBj0zHrzjid5WZDPeZH4dgJueeFSIw8UaddLDOexg233EFIXYuTQO4YVqB", // Block 1
	"oJHD2K2GLgoj9IpXoEDX6OuaJsl63YotYaw3hK90O331zX4pRWrmQuy2ARXWVVJsGu7sRso3hMSXv0BrGwrKp8qECTwDFMigJPDAeHUNjnzlQe2Yt0ybew5JnaSlB8bgSCfTeats1z2NSPoARruTNDztDEU3k05P6JMLQvFLCQAvqZNy0lgc9451QnpO4MEG3WDxlOGh9SGnpEetuFZC0JT5ldTcbcoYnhqS7cMkHVwiU7StpZRQeI4GbaY968tXj0ZZRliw8rLIUOli8icyQwZPGsHw9lFfjTR7qie7TzJ7hjsT7FGsefCWjZGSaGjF4lDn4DTzf4jqmDyK2Eq7BbHNLTzJoZKTt7cfCpfjuXlPmx41JEzbXPbsQZDCFq1VGrm9zrbBnyCAwBqj90sbheUe5B81pfcOiBj53UyQgIpB30hklQTgcMZUIb5HSOIyRmwvBab5piA55zjGML7I5MIFKvOGcVpYxFpMNgAeYcn2uhXd8EZq6g85GsLB3tvh", // Block 2
	"BTLHbjVWlhHy3vD9FLM2xQDshZqUpW6fRugQKxWMl2uY22DCi2Yz4hDqntU0iw6kmTh0CnjeCWFMWyEQCMxTWrkVRZ6Q1pAR17YDv0u1FaCLQ2NenspQL994bNU7eXbcCCY9AYrZyjmRNN7bT1F3Gi9RzIPNfvedgef9rVWT7m7zKWFS4CgGxSiJ8qt4qXelMUNKDUZLqeuEW0OgI5eyOGZeZ1G6s5LspxjEYn4gvSxBOepnnzI2WTPpMf0pvpdqU9lcBeqopUa6U7rYoEwjY7WGC2Cl1yXjFXhEgLv0ORCEksPgXONZiLT89QNE4Lfp6QPpLEdSc8yS4g12QYEYa5E06xEtigIT5X7m1uKXrQ0yPWzb3iqRmIruv1IsEHx2DXaYyaJv6e8BmA8MRJy8bMJxzy1YRQoakjDSKAuhLexHEYCU0yLjz40JSlKP7DHlEyo3aRzZLzwyVKlUuHLtQvI18md1tU06y9HxCteOjXKhFXbmhAka5lTRJvttpf9e", // Block 3
	"ekL2tSoZ4B8doDkVgkXN0dUVyc4Earh1uFe6z01KFqvCRf3eWavZXatORvBQw7", // Block 4 (partial)
]

const inflatedRandomNoise = inflatedRandomNoiseBlocks.join("")
const deflatedRandomNoise = pako.deflate(inflatedRandomNoise)

const path = "/deflateTest.data"
fs.writeFileSync(path, deflatedRandomNoise)

const concationatedDeflate = new Uint8Array(deflatedRandomNoise.length * 2)
concationatedDeflate.set(deflatedRandomNoise, 0)
// concationatedDeflate.set(deflated, deflated.length)

const concationatedDeflatePath = "/concationatedDeflate.data"
fs.writeFileSync(concationatedDeflatePath, concationatedDeflate)

describe("SeekInflate", () => {
	it("expect to throw when reading in a previous window (we may just warn)?", () => {
		//       |----|     <-- requested range
		//                  |---|  <- inflated window (restart would be reauired)
		const fileHandle = fs.openSync(path, "r")
		// this.fileSize = fs.statSync(filePath).size
		const snycBlobReader = new SeekInflate({
			inputChunkSize: 256,
			reader: (buffer, start, end) => {
				return fs.readSync(fileHandle, buffer, 0, end - start, start)
			},
		})
		const start = 1000
		const length = 12
		const block1Deflated = new Uint8Array(length)
		snycBlobReader.inflateRange(block1Deflated, start, length)
		const inputStr = inflatedRandomNoiseBlocks.join("")
		let error: any | undefined
		try {
			snycBlobReader.inflateRange(block1Deflated, start - 100, length)
		} catch (e) {
			error = e
		}
		expect(error).toBeDefined()
	})

	it("should continue deflation until the inflated window overlaps with the requested range", () => {
		const fileHandle = fs.openSync(path, "r")
		// this.fileSize = fs.statSync(filePath).size
		const snycBlobReader = new SeekInflate({
			inputChunkSize: 256,
			reader: (buffer, start, end) => {
				return fs.readSync(fileHandle, buffer, 0, end - start, start)
			},
		})
		const start = 306
		const length = 12
		const block1Deflated = new Uint8Array(length)
		snycBlobReader.inflateRange(block1Deflated, start, length)
		const block1DeflatedString = new TextDecoder().decode(block1Deflated as Uint8Array)
		const expectedDeflation = inflatedRandomNoise.substr(start, length)
		expect(block1DeflatedString).toBe(expectedDeflation)
	})

	it("should return the requested range if the current inflated window is sufficient", () => {
		const fileHandle = fs.openSync(path, "r")
		// this.fileSize = fs.statSync(filePath).size
		const snycBlobReader = new SeekInflate({
			inputChunkSize: 256,
			reader: (buffer, start, end) => {
				return fs.readSync(fileHandle, buffer, 0, end - start, start)
			},
		})
		const start = 0
		const length = 1
		const block1Deflated = new Uint8Array(length)
		snycBlobReader.inflateRange(block1Deflated, start, length)
		const block1DeflatedString = new TextDecoder().decode(block1Deflated as Uint8Array)
		const expectedDeflation = inflatedRandomNoise.substr(start, length)
		expect(block1DeflatedString).toBe(expectedDeflation)

		const start2 = 1
		const length2 = 1
		const block2Deflated = new Uint8Array(length2)
		snycBlobReader.inflateRange(block2Deflated, start2, length2)
		const block2DeflatedString = new TextDecoder().decode(block2Deflated as Uint8Array)
		const expectedDeflation2 = inflatedRandomNoise.substr(start2, length2)
		expect(block2DeflatedString).toBe(expectedDeflation2)
	})

	it("should return the requested range over multiple chunks", () => {
		// requested range is not fully covered by current window
		//       |------|     <-- requested range
		//     |-x-------|    <- inflated window
		const fileHandle = fs.openSync(path, "r")
		// this.fileSize = fs.statSync(filePath).size
		const snycBlobReader = new SeekInflate({
			inputChunkSize: 256,
			reader: (buffer, start, end) => {
				return fs.readSync(fileHandle, buffer, 0, end - start, start)
			},
		})
		const start = 0
		const length = 1000
		const block1Deflated = new Uint8Array(length)
		console.log("DEFLATING")
		snycBlobReader.inflateRange(block1Deflated, start, length)
		const block1DeflatedString = new TextDecoder().decode(block1Deflated as Uint8Array)
		const expectedDeflation = inflatedRandomNoise.substr(start, length)
		expect(block1DeflatedString).toBe(expectedDeflation)
	})

	it("should return the requested range if the current inflated window overlaps with the requeted range but is not fully covered", () => {
		// requested range is not fully covered by current window
		//       |------|     <-- requested range
		//     |-x-------|    <- inflated window
		const fileHandle = fs.openSync(path, "r")
		// this.fileSize = fs.statSync(filePath).size
		const snycBlobReader = new SeekInflate({
			inputChunkSize: 256,
			reader: (buffer, start, end) => {
				return fs.readSync(fileHandle, buffer, 0, end - start, start)
			},
		})
		const start = 2000
		const length = 400
		const block1Deflated = new Uint8Array(length)
		const bytesInflated = snycBlobReader.inflateRange(block1Deflated, start, length)
		expect(bytesInflated).toBe(110)
		const block1DeflatedString = new TextDecoder().decode(
			block1Deflated.subarray(0, bytesInflated) as Uint8Array
		)
		const expectedDeflation = inflatedRandomNoise.substr(start, length)
		expect(block1DeflatedString).toBe(expectedDeflation)
	})

	it("should return the requested range if it covers the whole inflated output", () => {
		// requested range is not fully covered by current window
		//       |------|     <-- requested range
		//     |-x-------|    <- inflated window
		const fileHandle = fs.openSync(path, "r")
		// this.fileSize = fs.statSync(filePath).size
		const snycBlobReader = new SeekInflate({
			inputChunkSize: 256,
			reader: (buffer, start, end) => {
				return fs.readSync(fileHandle, buffer, 0, end - start, start)
			},
		})
		const start = 0
		const length = inflatedRandomNoise.length
		const block1Deflated = new Uint8Array(length)
		const bytesInflated = snycBlobReader.inflateRange(block1Deflated, start, length)
		expect(bytesInflated).toBe(length)
		const block1DeflatedString = new TextDecoder().decode(
			block1Deflated.subarray(0, bytesInflated) as Uint8Array
		)
		const expectedDeflation = inflatedRandomNoise.substr(start, length)
		expect(block1DeflatedString).toBe(expectedDeflation)
	})

	it("should return the the whole inflated object when object end in stream", () => {
		// requested range is not fully covered by current window
		//       |------|     <-- requested range
		//     |-x-------|    <- inflated window
		const fileHandle = fs.openSync(concationatedDeflatePath, "r")
		// this.fileSize = fs.statSync(filePath).size
		const seekInflate = new SeekInflate({
			inputChunkSize: 256,
			reader: (buffer, start, end) => {
				const result = fs.readSync(fileHandle, buffer, 0, end - start, start)
				return result
			},
		})
		const start = 0
		const length = inflatedRandomNoise.length
		const block1Deflated = new Uint8Array(length)
		const bytesInflated = seekInflate.inflateRange(block1Deflated, start, length + 100)
		expect(bytesInflated).toBe(length)
		expect(seekInflate.deflatedBytes).toBe(deflatedRandomNoise.length)
		const block1DeflatedString = new TextDecoder().decode(
			block1Deflated.subarray(0, bytesInflated) as Uint8Array
		)
		const expectedDeflation = inflatedRandomNoise.substr(start, length)
		expect(block1DeflatedString).toBe(expectedDeflation)
	})

	it("crc32 of the full deflated content should be computed correctly if the whole inflated content is requested", () => {
		// requested range is not fully covered by current window
		//       |------|     <-- requested range
		//     |-x-------|    <- inflated window
		const fileHandle = fs.openSync(path, "r")

		const crc = crc32(deflatedRandomNoise)

		let currentCRC = 0

		// this.fileSize = fs.statSync(filePath).size
		const snycBlobReader = new SeekInflate({
			inputChunkSize: 256,
			reader: (buffer, start, end) => {
				return fs.readSync(fileHandle, buffer, 0, end - start, start)
			},
			onChunkDeflated: (buffer) => {
				currentCRC = crc32(buffer, currentCRC)
			},
		})
		const start = 0
		const length = inflatedRandomNoise.length
		const block1Deflated = new Uint8Array(length)
		const bytesInflated = snycBlobReader.inflateRange(block1Deflated, start, length)
		// console.log("DEFLATED CRC " + snycBlobReader.deflatedCrcState)
		expect(currentCRC).toBe(crc)
	})

	it("crc32 of the full deflated content should be computed correctly if only the last byte is requested", () => {
		// requested range is not fully covered by current window
		//       |------|     <-- requested range
		//     |-x-------|    <- inflated window
		const fileHandle = fs.openSync(path, "r")

		const crc = crc32(deflatedRandomNoise)
		let currentCRC = 0

		// this.fileSize = fs.statSync(filePath).size
		const snycBlobReader = new SeekInflate({
			inputChunkSize: 256,
			reader: (buffer, start, end) => {
				return fs.readSync(fileHandle, buffer, 0, end - start, start)
			},
			onChunkDeflated: (buffer) => {
				currentCRC = crc32(buffer, currentCRC)
			},
		})
		const start = inflatedRandomNoise.length - 1
		const length = inflatedRandomNoise.length
		let block1Deflated = new Uint8Array(length)
		const bytesInflated = snycBlobReader.inflateRange(block1Deflated, start, length)
		// console.log("DEFLATED CRC " + snycBlobReader.deflatedCrcState)
		expect(bytesInflated).toBe(1)
		expect(currentCRC).toBe(crc)
	})

	it("sha1 of the full deflated content should be computed correctly if the whole inflated content is requested", () => {
		// requested range is not fully covered by current window
		//       |------|     <-- requested range
		//     |-x-------|    <- inflated window
		const fileHandle = fs.openSync(path, "r")

		const sha1Inflated = sha1(new TextEncoder().encode(inflatedRandomNoise))

		// this.fileSize = fs.statSync(filePath).size
		const seekInflator = new SeekInflate({
			inputChunkSize: 256,
			reader: (buffer, start, end) => {
				return fs.readSync(fileHandle, buffer, 0, end - start, start)
			},
			inflatedHasher: new SHA1(),
		})
		const start = 0
		const length = inflatedRandomNoise.length
		const inflated = new Uint8Array(length)
		const bytesInflated = seekInflator.inflateRange(inflated, start, length)
		// console.log("DEFLATED CRC " + snycBlobReader.deflatedCrcState)
		expect(sha1(inflated)).toStrictEqual(sha1Inflated)
		expect(seekInflator.inflatedHasher?.digest()).toStrictEqual(sha1Inflated)
	})

	it("sha1 of the full deflated content should be computed correctly if only the last byte is requested", () => {
		// requested range is not fully covered by current window
		//       |------|     <-- requested range
		//     |-x-------|    <- inflated window
		const fileHandle = fs.openSync(path, "r")

		const sha1Inflated = sha1(new TextEncoder().encode(inflatedRandomNoise))

		// this.fileSize = fs.statSync(filePath).size
		const seekInflator = new SeekInflate({
			inputChunkSize: 256,
			reader: (buffer, start, end) => {
				return fs.readSync(fileHandle, buffer, 0, end - start, start)
			},
			inflatedHasher: new SHA1(),
		})
		const start = inflatedRandomNoise.length - 1
		const length = inflatedRandomNoise.length
		const inflated = new Uint8Array(length)
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		const bytesInflated = seekInflator.inflateRange(inflated, start, length)
		expect(seekInflator.inflatedHasher?.digest()).toStrictEqual(sha1Inflated)
	})
})

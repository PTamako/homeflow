import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {validatedTripPayload} from '../worker/trips.js'
test('documented HomeFlow Trip v1 example validates',()=>{
 const example=JSON.parse(readFileSync(new URL('../examples/hokkaido-trip-v1.json',import.meta.url),'utf8'))
 const schema=JSON.parse(readFileSync(new URL('../schemas/homeflow-trip-v1.schema.json',import.meta.url),'utf8'))
 assert.equal(schema.properties.format.const,example.format)
 assert.equal(schema.properties.schemaVersion.const,example.schemaVersion)
 assert.equal(validatedTripPayload(example),null)
})

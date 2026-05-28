import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildGeneratedData } from './preprocess/build-data.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

buildGeneratedData({ repoRoot })

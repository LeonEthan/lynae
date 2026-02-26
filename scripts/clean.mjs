#!/usr/bin/env node
/**
 * Cross-platform clean script - replaces rm -rf
 * Usage: node scripts/clean.mjs <path1> [path2] ...
 */

import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const targets = process.argv.slice(2)

if (targets.length === 0) {
  console.error('Usage: node scripts/clean.mjs <path1> [path2] ...')
  process.exit(1)
}

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const projectRoot = resolve(__dirname, '..')

async function clean() {
  for (const target of targets) {
    const fullPath = resolve(projectRoot, target)
    try {
      await rm(fullPath, { recursive: true, force: true })
      console.log(`Cleaned: ${target}`)
    } catch (error) {
      console.error(`Failed to clean ${target}:`, error.message)
      process.exit(1)
    }
  }
}

clean()

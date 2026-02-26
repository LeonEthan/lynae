#!/usr/bin/env node
/**
 * Cross-platform clean script - replaces rm -rf
 * Usage: node scripts/clean.mjs <path1> [path2] ...
 */

import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'

const targets = process.argv.slice(2)

if (targets.length === 0) {
  console.error('Usage: node scripts/clean.mjs <path1> [path2] ...')
  process.exit(1)
}

const baseDir = process.cwd()

async function clean() {
  for (const target of targets) {
    const fullPath = resolve(baseDir, target)
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

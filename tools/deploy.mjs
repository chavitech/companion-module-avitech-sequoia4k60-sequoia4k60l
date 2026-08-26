/**
 * Copies this repo into a Bitfocus Companion "developer modules" folder so a real Companion can
 * load it.
 *
 * Why this exists rather than a symlink: on this workspace Companion runs on Windows while the repo
 * lives on WSL2's ext4, and the two cannot be bridged.
 *
 * - Windows refuses `mklink /D` to a UNC target, so there is no Windows-side link into WSL.
 * - Pointing Companion's dev-modules path straight at `\\wsl.localhost\...` fails on Companion
 *   5.0.1. Its module loader builds the import URL by string concatenation:
 *
 *   ```js
 *   var DI = e => process.platform === 'win32' && !e.startsWith('file://') ? `file://${e}` : e
 *   ```
 *
 *   For a drive path that limps along; for a UNC path it yields `file://\\host\share\...`, which is
 *   not a valid absolute file URL. The module dies with `ERR_INVALID_FILE_URL_PATH` during
 *   registration, which Companion then reports as the far less helpful "Failed to init: Call timed
 *   out". `pathToFileURL(e).href` would handle both. If that is ever fixed upstream, this script
 *   becomes unnecessary and the dev-modules path can point into WSL directly.
 *
 * So the module is copied to a real Windows directory instead. rsync rather than a plain copy
 * because only `dist/` changes between runs: the first copy moves ~87MB of `node_modules` and is
 * slow over DrvFs, every later one moves a handful of files.
 *
 * Usage, from the repo root:
 *
 * ```bash
 * yarn deploy --to /mnt/c/Testing/development/companion-module-avitech-sequoia4k60-sequoia4k60l
 * COMPANION_DEV_PATH=/mnt/c/... yarn deploy
 * ```
 *
 * `yarn deploy` builds first. Deploying a stale `dist/` is the one failure this is most likely to
 * cause, because Companion runs `dist/main.js` and never looks at the TypeScript.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '..')

function fail(message) {
	throw new Error(message)
}

function targetFromArgs(argv) {
	const flagIndex = argv.indexOf('--to')

	if (flagIndex !== -1) {
		const value = argv[flagIndex + 1]

		return value && !value.startsWith('--') ? value : fail('--to needs a path')
	}

	return process.env.COMPANION_DEV_PATH ?? ''
}

function main() {
	const rawTarget = targetFromArgs(process.argv.slice(2)).trim()

	if (!rawTarget) {
		fail(
			'no destination. Pass --to <path> or set COMPANION_DEV_PATH to the module folder inside\n' +
				"        Companion's developer modules path, e.g.\n" +
				'        /mnt/c/Testing/development/companion-module-avitech-sequoia4k60-sequoia4k60l',
		)
	}

	const target = resolve(rawTarget)

	// The rsync below runs with --delete, so a wrong target does not just add files, it empties one.
	// These three checks are what stands between a typo and that.
	if (target === '/' || dirname(target) === target) {
		fail(`refusing to deploy to ${target}`)
	}

	if (target === repoRoot) {
		fail('refusing to deploy the repo onto itself')
	}

	if (!existsSync(dirname(target))) {
		fail(`the parent of ${target} does not exist - is Companion's developer modules path set up?`)
	}

	if (existsSync(target) && !statSync(target).isDirectory()) {
		fail(`${target} exists and is not a directory`)
	}

	// -L copies what a symlink points at rather than the link. The only symlinks here are the CLI shims
	// in node_modules/.bin, which nothing needs at runtime, but DrvFs cannot represent them and rsync
	// would otherwise print a "skipping non-regular file" warning per entry.
	const args = ['-rLt', '--delete', '--exclude', '.git', '--exclude', '.yarn', `${repoRoot}/`, `${target}/`]

	console.log(`deploy: ${repoRoot} -> ${target}`)

	const result = spawnSync('rsync', args, { stdio: 'inherit' })

	if (result.error) {
		fail(result.error.code === 'ENOENT' ? 'rsync is not installed' : result.error.message)
	}

	if (result.status !== 0) {
		fail(`rsync exited ${result.status}`)
	}

	console.log('deploy: done. Restart the connection in Companion to pick up the new build.')
}

try {
	main()
} catch (error) {
	console.error(`deploy: ${error.message}`)
	process.exitCode = 1
}

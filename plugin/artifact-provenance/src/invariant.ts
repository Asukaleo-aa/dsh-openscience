/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-artifact-provenance`.
 * @module @deepseek-ai/dsh-artifact-provenance/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-artifact-provenance'

/** Cordis companion plugin name. */
export const name = 'provenance-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the manifest is a pure fold over the session log,
 * proven by package tests; there is no in-process commit relation to guard.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))

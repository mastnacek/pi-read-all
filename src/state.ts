// Session-scoped counters shared by the input interceptor and /read-all.

export interface SessionStats {
	totalLoads: number;
	totalFilesLoaded: number;
	totalBytesLoaded: number;
	totalTokensLoaded: number;
}

/**
 * Live counters. A const *object* rather than a module-level `let`, because
 * an imported binding cannot be reassigned from another module.
 */
export const sessionStats: SessionStats = {
	totalLoads: 0,
	totalFilesLoaded: 0,
	totalBytesLoaded: 0,
	totalTokensLoaded: 0,
};

/** Zero the counters (called on session start and shutdown). */
export function resetSessionStats(): void {
	sessionStats.totalLoads = 0;
	sessionStats.totalFilesLoaded = 0;
	sessionStats.totalBytesLoaded = 0;
	sessionStats.totalTokensLoaded = 0;
}

# P2-4 Evaluation: React Query / SWR Adoption

## Current State Analysis

The Flux Operations Center has **~30+ fetch calls** across App.tsx handling:
- Initial data loading (assets, topology, metro, feeders)
- Spatial layer loading (power lines, vegetation, buildings)
- Real-time status updates (substation status)
- On-demand data (connected assets, circuit data)
- Weather and service area polling

### Existing Caching Mechanisms
The app already implements sophisticated caching:
- `loadingCircuitsRef`, `loadedCircuitsRef` - Track in-flight/loaded circuits
- `lastDataHashRef` - Detect data changes
- `limitsReachedRef` - Prevent retry spam
- `lastLoadAttemptViewportRef` - Viewport change detection
- `lastCullTimeRef` - Throttle culling operations

### Benefits of React Query/SWR
1. **Automatic Caching** - Built-in cache management
2. **Deduplication** - Prevents duplicate requests
3. **Background Refetching** - Keep data fresh
4. **Loading/Error States** - Standardized handling
5. **DevTools** - Query inspection and debugging
6. **Retry Logic** - Built-in exponential backoff

### Challenges for This App
1. **Complex Viewport-Based Loading** - Data loading is tightly coupled to map viewport
2. **Progressive Loading** - Circuit-by-circuit loading with limits
3. **Memory Management** - Active culling of off-viewport data
4. **Custom Deduplication** - Already implemented via refs
5. **Real-Time Updates** - Substation status polling

## Recommendation

**DEFER for now.** The app has specialized data loading patterns that would require significant refactoring:

1. Viewport-based loading would need custom `queryKey` strategies
2. Progressive circuit loading doesn't fit standard query patterns
3. Memory culling logic would need to integrate with cache invalidation
4. Risk of introducing bugs in complex data flow

### Future Consideration
If pursuing React Query later:
1. Start with simple endpoints (weather, KPIs)
2. Use `useInfiniteQuery` for progressive loading
3. Implement custom `queryFn` for viewport-based queries
4. Consider `@tanstack/react-query` v5 for better TypeScript support

### Alternative Quick Wins
Instead, consider these lighter improvements:
- [ ] Extract fetch calls into dedicated API service module
- [ ] Add request deduplication middleware
- [ ] Implement SWR-style stale-while-revalidate pattern manually
- [ ] Add AbortController cleanup to all fetch calls

## Conclusion

**ROI Assessment: LOW for immediate implementation**

The existing custom caching is well-suited to the app's specialized needs. React Query would add complexity without proportional benefit given the viewport-driven, progressive loading architecture.

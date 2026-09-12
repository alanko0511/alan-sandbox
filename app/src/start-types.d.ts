// TanStack Start contributes the `server.handlers` option to file routes via
// declaration merging in @tanstack/start-client-core. Nothing else in this app
// imports the start package at type level, so without this reference the
// `server` key on a route is reported as unknown.
import type {} from '@tanstack/react-start'

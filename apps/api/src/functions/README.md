# Functions

Third-party backend logic — pricing, discounts, validation — compiled to
WebAssembly and run on our servers. §22.3.

## The trust boundary is one file

`infrastructure/worker.mjs`. Everything above it is our code; everything a
guest does happens inside a `WebAssembly.Instance` created there, with an
import object containing exactly two functions.

It is plain JavaScript with no imports beyond `worker_threads`, deliberately. A
worker that pulled in the platform's modules would hand a guest a much larger
surface the moment one of them became reachable from an import — and the whole
argument of §22.3 is that the surface is small enough to read in one sitting.

## Why the import check is the security model

A WebAssembly module cannot reach anything the host does not hand it. No
syscalls, no ambient network, no filesystem, no clock. So the entire attack
surface is the import table, and that is inspectable **before instantiation** —
`WebAssembly.compile` validates the binary and exposes the tables without
running any guest code.

A module importing `wasi_snapshot_preview1` wants a filesystem. One importing
`env.now` wants a clock and is therefore not deterministic. Both are refused by
name, because "your module was rejected" without saying what it wanted is a
support ticket rather than an error message.

## Why the timeout terminates

A guest in an infinite loop never yields, so a cooperative deadline is one it
ignores. The worker is killed. The test for this runs an actual looping module
and asserts the call returns — a mocked runner would pass while providing no
isolation at all.

## What "separate tier" means here

A worker thread. In production it is a separate deployment, and the isolation
that matters is the same either way: a guest cannot reach the API's memory,
cannot block its event loop, and can be killed. The deployment boundary adds
fault isolation and independent scaling on top, which is a hosting decision
rather than a code one.

## Limits are small on purpose

200ms, 80 pages, 5 MiB. A function needing more than that is doing something
the platform should be doing, and raising a limit should be a decision somebody
makes deliberately rather than one they inherit.

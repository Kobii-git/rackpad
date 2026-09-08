# SARIF validation schema

`sarif-schema-2.1.0.json` is the unmodified OASIS SARIF 2.1.0 schema from
[sarif-spec revision a560296](https://github.com/oasis-tcs/sarif-spec/blob/a560296ca8c921f3bdb8d4a8db57ab83dae968a7/sarif-2.1/schema/sarif-schema-2.1.0.json).
Its SHA-256 is `c3b4bb2d6093897483348925aaa73af03b3e3f4bd4ca38cef26dcb4212a2682e`.
The upstream repository's license notice is retained in `OASIS-LICENSE.md`.

The publication checker validates raw analysis against this schema before applying
the exact reviewed SNMP exceptions. Validation uses development-only Ajv tooling;
the application runtime and database schema are unaffected. Update this pinned
schema only with review and compatibility tests against actual CodeQL output.

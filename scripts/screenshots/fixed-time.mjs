export const SCREENSHOT_TIME_MS = Date.parse("2026-08-24T18:00:00.000Z");

if (process.env.RACKPAD_FREEZE_SCREENSHOT_TIME === "1") {
  const RealDate = globalThis.Date;
  globalThis.Date = new Proxy(RealDate, {
    construct(target, args) {
      return Reflect.construct(
        target,
        args.length === 0 ? [SCREENSHOT_TIME_MS] : args,
      );
    },
    get(target, property, receiver) {
      if (property === "now") return () => SCREENSHOT_TIME_MS;
      return Reflect.get(target, property, receiver);
    },
  });
}

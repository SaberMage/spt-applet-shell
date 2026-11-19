// Wait for args.delay_ms, then send args.text to the owner.
// Run: spt shell cmd applet-0 run applets/timed-send.ts '{"delay_ms":60000,"text":"Check the build."}'
export default async function (ctx: {
  args: { delay_ms: number; text: string };
  sleep(ms: number): Promise<void>;
  say(text: string): Promise<void>;
}) {
  await ctx.sleep(ctx.args.delay_ms);
  await ctx.say(ctx.args.text);
}

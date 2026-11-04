import { describe, expect, it } from "vitest";
import { assertPublicUrl, BlockedUrlError, checkUrlSyntax, isBlockedAddress } from "./url-guard.js";

describe("url guard", () => {
  it.each([
    "http://api.example.com",
    "ftp://api.example.com",
    "https://user:pass@api.example.com",
    "https://localhost",
    "https://localhost.",
    "https://foo.localhost",
    "https://printer.local",
    "https://metadata.google.internal",
    "https://router.home.arpa",
    "https://intranet",
    "https://127.0.0.1",
    "https://2130706433",
    "https://0x7f.1",
    "https://10.1.2.3",
    "https://100.64.0.1",
    "https://169.254.169.254",
    "https://172.16.0.1",
    "https://172.31.255.255",
    "https://192.168.1.1",
    "https://0.0.0.0",
    "https://224.0.0.1",
    "https://255.255.255.255",
    "https://198.18.0.1",
    "https://[::]",
    "https://[::1]",
    "https://[::ffff:127.0.0.1]",
    "https://[::ffff:10.0.0.1]",
    "https://[::127.0.0.1]",
    "https://[64:ff9b::7f00:1]",
    "https://[fc00::1]",
    "https://[fd00:ec2::254]",
    "https://[fe80::1]",
    "https://[ff02::1]",
    "https://[2001:db8::1]",
    "https://[2002:7f00:1::]",
    "https://[2001::1]",
    "not a url",
  ])("blocks %s", (url) => {
    expect(() => checkUrlSyntax(url)).toThrow(BlockedUrlError);
  });

  it.each([
    "https://api.example.com/v1",
    "https://93.184.216.34",
    "https://[2606:4700::1111]",
    "https://api.example.com:8443",
  ])("accepts %s", (url) => {
    expect(checkUrlSyntax(url).href).toBeTruthy();
  });

  it("checks every resolved address and fails closed", async () => {
    const resolveTo = (ips: string[]) => async () => ips;
    await expect(assertPublicUrl("https://api.example.com", resolveTo(["93.184.216.34"]))).resolves.toBeTruthy();
    await expect(assertPublicUrl("https://evil.example.com", resolveTo(["93.184.216.34", "10.0.0.5"]))).rejects.toThrow(
      /private or internal/,
    );
    await expect(assertPublicUrl("https://evil.example.com", resolveTo(["::ffff:169.254.169.254"]))).rejects.toThrow(
      /private or internal/,
    );
    await expect(assertPublicUrl("https://gone.example.com", resolveTo([]))).rejects.toThrow(/could not be resolved/);
    await expect(
      assertPublicUrl("https://down.example.com", async () => {
        throw new Error("timeout");
      }),
    ).rejects.toThrow(/could not be resolved/);
  });

  it("treats unparseable addresses as blocked", () => {
    expect(isBlockedAddress("garbage")).toBe(true);
    expect(isBlockedAddress("1:2:3")).toBe(true);
  });
});

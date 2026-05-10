/**
 * Verifier prompts require a machine-readable line anywhere in the response:
 * `AGENTIC_MY_APP_VERDICT: PASS` or `AGENTIC_MY_APP_VERDICT: FAIL`
 * (legacy `ORCHESTRATOR_VERDICT` is still accepted).
 */

export function extractAgenticMyAppVerifierVerdict(
  verifierNotes: string,
): "PASS" | "FAIL" | undefined {
  const m = verifierNotes.match(
    /(?:AGENTIC_MY_APP_VERDICT|ORCHESTRATOR_VERDICT):\s*(PASS|FAIL)\b/i,
  );
  if (!m?.[1]) return undefined;
  return m[1].toUpperCase() === "PASS" ? "PASS" : "FAIL";
}

export function extractAgenticMyAppManualQaVerdict(
  manualQaNotes: string,
): "PASS" | "FAIL" | undefined {
  const m = manualQaNotes.match(
    /AGENTIC_MY_APP_MANUAL_QA_VERDICT:\s*(PASS|FAIL)\b/i,
  );
  if (!m?.[1]) return undefined;
  return m[1].toUpperCase() === "PASS" ? "PASS" : "FAIL";
}

/** True only when mechanical checks passed and verifier/manual-QA did not emit FAIL. */
export function verificationGatePassed(args: {
  mechanicalPass: boolean;
  verifierNotes: string;
  manualQaNotes?: string;
}): boolean {
  if (!args.mechanicalPass) return false;
  if (
    args.manualQaNotes !== undefined &&
    extractAgenticMyAppManualQaVerdict(args.manualQaNotes) === "FAIL"
  ) {
    return false;
  }
  return extractAgenticMyAppVerifierVerdict(args.verifierNotes) !== "FAIL";
}

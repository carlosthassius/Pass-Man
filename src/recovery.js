export function buildRecoveryFile(recoveryId, recoverySecret) {
  return { app:'Pass-Man', type:'recovery-key', version:1, recoveryId, recoverySecret, createdAt:new Date().toISOString() };
}

import type { ProgramState } from "@gymspot/engine";
import { QR_TTL_MS, type SignedDelegation, createQr } from "@gymspot/shared";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useServices } from "../services";

// A7 on the phone: show the signed handoff QR for the next block (specs/03, 07).
// The QR lives 2 minutes, so it is renewed every 90 seconds.

export const QR_REFRESH_MS = 90_000;

export interface HandoffPanelProps {
  state: ProgramState;
  phoneSecretKey: Uint8Array;
  delegation: SignedDelegation;
  onRunHere(): void;
  onReturned(): void;
  /** Renders the QR text to an image URL (qrcode in the app). */
  renderQr?: (text: string) => Promise<string>;
}

export function HandoffPanel({ state, phoneSecretKey, delegation, onRunHere, onReturned, renderQr = defaultRender }: HandoffPanelProps) {
  const { t } = useTranslation();
  const services = useServices();
  const [image, setImage] = useState<string | null>(null);
  const { blockIndex } = state.cursor;
  const block = state.config.workout.blocks[blockIndex];

  useEffect(() => {
    if (!block) return;
    let cancelled = false;
    const make = async () => {
      const now = services.now();
      const qr = await createQr(
        {
          v: 1,
          tid: delegation.delegation.tid,
          mid: delegation.delegation.mid,
          sid: state.config.sessionId,
          bi: blockIndex,
          si: 0,
          blk: block,
          jti: services.newId(),
          exp: now + QR_TTL_MS,
        },
        phoneSecretKey,
        delegation,
      );
      const url = await renderQr(qr);
      if (!cancelled) setImage(url);
    };
    void make();
    const h = setInterval(() => void make(), QR_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(h);
    };
  }, [block, blockIndex, delegation, phoneSecretKey, renderQr, services, state.config.sessionId]);

  return (
    <section data-screen="A7">
      <h1>{t("screens.A7")}</h1>
      {block?.stationHint && <p className="station-hint">{block.stationHint}</p>}
      <p>{t("phone.handoffHint")}</p>
      {image && <img src={image} alt={t("phone.handoffQr")} className="handoff-qr" />}
      <div className="controls">
        <button onClick={onReturned}>{t("phone.returned")}</button>
        <button onClick={onRunHere}>{t("phone.runHere")}</button>
      </div>
    </section>
  );
}

const defaultRender = (text: string) => QRCode.toDataURL(text, { errorCorrectionLevel: "M", margin: 2, width: 360 });

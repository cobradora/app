"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const STORAGE_KEY = "cobradora_cookie_consent";

export function CookieConsentBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // localStorage não existe no SSR — o estado inicial precisa ser `false`
    // pros dois lados (servidor/cliente) baterem na hidratação, e só decidir
    // se mostra o banner depois de montar no navegador.
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- leitura única de localStorage, não dá pra saber antes de montar no cliente (ver comentário acima).
      if (!window.localStorage.getItem(STORAGE_KEY)) setVisible(true);
    } catch {
      // localStorage indisponível (modo privado restrito, etc.) — não bloqueia a navegação.
    }
  }, []);

  function dismiss(choice: "accepted" | "rejected_non_essential") {
    try {
      window.localStorage.setItem(STORAGE_KEY, choice);
    } catch {
      // Se não der pra salvar, o banner só volta a aparecer na próxima visita.
    }
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div className="cookie-banner" role="dialog" aria-label="Aviso de cookies" aria-live="polite">
      <p>
        Usamos apenas o cookie essencial de sessão para manter você autenticado — nenhum cookie de publicidade,
        rastreamento ou analytics. Saiba mais na{" "}
        <Link href="/politica-de-cookies">Política de Cookies</Link>.
      </p>
      <div className="cookie-banner__actions">
        <button type="button" className="button button--secondary button--small" onClick={() => dismiss("rejected_non_essential")}>
          Rejeitar não essenciais
        </button>
        <button type="button" className="button button--primary button--small" onClick={() => dismiss("accepted")}>
          Entendi
        </button>
      </div>
    </div>
  );
}

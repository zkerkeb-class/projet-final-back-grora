import fs from 'fs';
import csv from 'csv-parser';
import iconv from 'iconv-lite';

export function parseBankCsv(filePath, userId) {
    return new Promise((resolve, reject) => {
        const results = [];

        fs.createReadStream(filePath)
            .pipe(iconv.decodeStream('latin1'))
            .pipe(csv({ separator: ';', skipLines: 2 }))
            .on('data', (data) => {
                try {
                    const rawDate = data["Date de l'opération"];
                    const rawAmount = data["Montant de l'opération"];
                    const rawLabel = (data["Libellé"] || '').trim();
                    const rawDetails = (data["Détail de l'écriture"] || '').trim();

                    if (!rawDate || !rawAmount) {
                        console.warn('[CSV Parse] Ligne ignorée (date ou montant manquant)', { rawDate, rawAmount });
                        return;
                    }

                    const [day, month, year] = rawDate.split('/');
                    const cleanDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                    const cleanAmount = parseFloat(rawAmount.replace(',', '.').replace(/\s/g, ''));

                    if (!Number.isFinite(cleanAmount)) {
                        console.warn('[CSV Parse] Montant invalide:', rawAmount);
                        return;
                    }

                    const title = extractTitle(rawLabel, rawDetails);
                    const tag = extractTag(rawLabel, rawDetails);

                    results.push({
                        title,
                        details: rawDetails,
                        amount: cleanAmount,
                        date: cleanDate,
                        user_id: userId,
                        category: 'PERSO',
                        tag,
                    });
                } catch (parseErr) {
                    console.error('[CSV Parse] Erreur lors du parsing d\'une ligne:', parseErr.message);
                }
            })
            .on('end', () => {
                console.log(`[CSV Parse] Parsing terminé: ${results.length} lignes extraites`);
                resolve(results);
            })
            .on('error', (err) => {
                console.error('[CSV Parse] Erreur flux:', err.message);
                reject(err);
            });
    });
}

/**
 * Extrait un titre lisible (nom du marchand / destinataire) depuis le libellé et le détail.
 *
 * Patterns reconnus dans les relevés Société Générale :
 *   CARTE Xxxxx DD/MM <MARCHAND> ...
 *   PRELEVEMENT EUROPEEN ... DE: <ENTITÉ> ...
 *   VIR RECU ... DE: <ÉMETTEUR> ...
 *   VIR INSTANTANE EMIS ... POUR: <DESTINATAIRE> ...
 *   VIR EUROPEEN EMIS ... POUR: <DESTINATAIRE> ...
 *   COTISATION MENSUELLE <NOM> ...
 *   CARTE Xxxxx REMBT ... <MARCHAND> ...
 */
function extractTitle(label, details) {
    // 1) Paiement carte → extraire le marchand depuis le détail
    if (label.startsWith('CARTE') && !label.includes('REMBT')) {
        const merchant = extractMerchantFromCard(details);
        if (merchant) return merchant;
    }

    // 2) Remboursement carte
    if (label.includes('REMBT')) {
        const merchant = extractMerchantFromCard(details);
        if (merchant) return `Remboursement ${merchant}`;
    }

    // 3) Virement reçu → DE: <nom>
    if (label.includes('VIR RECU')) {
        const sender = extractAfterKeyword(details, 'DE:');
        if (sender) return `Virement de ${sender}`;
    }

    // 4) Virement émis (instantané ou européen) → POUR: <nom>
    if (label.includes('VIR INSTANT') || label.includes('VIR EUROPEE')) {
        const recipient = extractAfterKeyword(details, 'POUR:');
        if (recipient) return `Virement à ${recipient}`;
    }

    // 5) Prélèvement → DE: <entité>
    if (label.includes('PRELEVEMENT')) {
        const entity = extractAfterKeyword(details, 'DE:');
        if (entity) return entity;
    }

    // 6) Cotisation
    if (label.includes('COTISATION')) {
        const name = details.replace(/COTISATION\s+MENSUELLE\s*/i, '').trim();
        if (name) return name;
    }

    // Fallback : libellé nettoyé
    return cleanLabel(label) || 'Transaction';
}

/**
 * Extrait le nom du marchand depuis un détail de type CARTE.
 * Ex: "CARTE X4828 20/12 MINISO 230535504520898IOPD" → "Miniso"
 * Ex: "CARTE X4828 16/12 FNAC.COM COMMERCE ELECTRONIQUE 110535200365151IOPD" → "Fnac.com"
 */
function extractMerchantFromCard(details) {
    // Supprime le préfixe "CARTE Xxxxx DD/MM " ou "CARTE Xxxxx REMBT DD/MM "
    const withoutPrefix = details.replace(/^CARTE\s+\S+\s+(?:REMBT\s+)?\d{2}\/\d{2}\s+/i, '');
    if (!withoutPrefix || withoutPrefix === details) return null;

    // Supprime les identifiants numériques longs, "IOPD", "ILIC", "COMMERCE ELECTRONIQUE", montants, pays
    let merchant = withoutPrefix
        .replace(/\d{6,}\S*/g, '')                          // IDs longs
        .replace(/\bIOPD\b|\bILIC\b/gi, '')                 // suffixes de transaction
        .replace(/\bCOMMERCE\s+ELECTRONIQUE\b/gi, '')       // e-commerce
        .replace(/\d+[,.]\d{2}\s*EUR/gi, '')                // montants
        .replace(/\b(FRANCE|GRECE|BELGIQUE|ALLEMAGNE|ESPAGNE|ITALIE|PAYS-BAS|PORTUGAL)\b/gi, '') // pays
        .replace(/\s{2,}/g, ' ')
        .trim();

    if (!merchant) return null;

    // Capitalise proprement
    return capitalize(merchant);
}

/**
 * Extrait le texte après un mot-clé (DE:, POUR:, etc.)
 * et nettoie le résultat.
 */
function extractAfterKeyword(text, keyword) {
    const idx = text.indexOf(keyword);
    if (idx === -1) return null;

    let value = text.substring(idx + keyword.length).trim();

    // Coupe au prochain mot-clé, pattern de date, ref ou info bancaire (BQ, CPT, SG, etc.)
    value = value
        .split(/\s+(?:ID:|MOTIF:|REF:|DATE:|\d{2}\/\d{2}\/\d{4}|\d{2}\s+\d{2}\s+BQ\b|\d{2}\s+\d{2}\s+SG\b)/)[0]
        .replace(/\s{2,}/g, ' ')
        .trim();

    // Supprime les préfixes M. / Mme / Mr
    value = value.replace(/^(M\.|Mme|Mr\.?)\s+/i, '');

    return capitalize(value) || null;
}

/**
 * Détermine un tag automatique basé sur le type de transaction.
 */
function extractTag(label, details) {
    const l = label.toUpperCase();
    const d = details.toUpperCase();

    if (l.includes('COTISATION'))                     return 'abonnement';
    if (d.includes('AMAZON'))                         return 'shopping';
    if (d.includes('FNAC'))                           return 'shopping';
    if (d.includes('LIDL') || d.includes('AUCHAN') || d.includes('CARREFOUR') || d.includes('LECLERC')) 
                                                      return 'courses';
    if (d.includes('FITNESS') || d.includes('SPORT')) return 'sport';
    if (d.includes('PLANITY'))                        return 'bien-être';
    if (l.includes('PRELEVEMENT'))                    return 'prélèvement';
    if (l.includes('VIR RECU'))                       return 'revenu';
    if (l.includes('VIR INSTANT') || l.includes('VIR EUROPEE')) return 'virement';
    if (l.includes('REMBT'))                          return 'remboursement';
    if (l.includes('CARTE'))                          return 'carte';

    return 'autre';
}

function cleanLabel(label) {
    return label
        .replace(/\s+X\d{4}\s+/g, ' ')   // retire "X4828"
        .replace(/\d{2}\/\d{2}/g, '')     // retire les dates DD/MM
        .replace(/\s{2,}/g, ' ')
        .trim();
}

function capitalize(str) {
    if (!str) return str;
    return str
        .toLowerCase()
        .split(' ')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}

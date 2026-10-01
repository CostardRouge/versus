import type { LegalMessages } from './legal-en.ts';

/** Textes des mentions légales (src/legal/) : mêmes clés, mêmes marqueurs et même balisage que legal-en.ts. */
export const legalFr: LegalMessages = {
  title: 'Mentions légales et confidentialité',
  intro:
    'Qui publie Versus, qui l’héberge, et ce qu’il sait de toi : très peu. Tes classements ne quittent jamais ton navigateur, sauf si tu en publies un.',
  updated: 'Dernière mise à jour le 30 septembre 2026.',
  tocAria: 'Sur cette page',

  pubTitle: 'Éditeur',
  pub1: 'Versus est édité par <b>Steeve Pommier</b>, particulier, à titre non commercial : il est gratuit, sans publicité, et ne vend rien.',
  pubContact: 'Contact : {email}',
  pub2: 'En tant qu’éditeur non professionnel, les informations d’identification prévues par la loi (Loi pour la confiance dans l’économie numérique, art. 6-III) sont conservées auprès de l’hébergeur ci-dessous.',

  hostTitle: 'Hébergement',
  host1:
    '<b>versus.steevepommier.com</b> tourne sur Cloudflare Workers, qui conserve aussi les classements publiés : Cloudflare, Inc., 101 Townsend Street, San Francisco, CA 94107, États-Unis, <a href="https://www.cloudflare.com">cloudflare.com</a>.',
  host2:
    'Une copie sans publication est servie par GitHub Pages à l’adresse <b>costardrouge.github.io/versus</b> : GitHub, Inc., 88 Colin P. Kelly Jr. Street, San Francisco, CA 94107, États-Unis, <a href="https://github.com">github.com</a>.',
  host3: 'La mesure d’audience tourne sur un serveur de l’éditeur (voir Confidentialité).',

  privTitle: 'Confidentialité',
  privShort:
    'En bref : Versus ne sait pas qui tu es et ne cherche pas à le savoir. Pas de compte, pas de cookie, pas de publicité.',

  deviceTitle: 'Sur ton appareil',
  device1:
    'Tes classements, leurs éléments (images comprises), tes duels et tes préférences (langue, thème, choix d’affichage) sont gardés dans le stockage local de ton navigateur, sur cet appareil seulement. S’y trouvent aussi, si tu utilises les classements publiés, un identifiant de votant anonyme (une suite de caractères au hasard), les clés des classements que tu as publiés et les cartes de « Tes votes ».',
  device2:
    'L’app installée garde aussi ses propres fichiers dans le cache du navigateur pour marcher hors ligne : des fichiers, jamais tes données. Rien de tout cela n’est envoyé nulle part, sauf ce que tu publies. Pour l’effacer, supprime tes classements dans l’app, ou efface les données de ce site dans les réglages de ton navigateur.',

  boardsTitle: 'Classements publiés',
  boards1:
    'Quand tu publies un classement, son titre, ses éléments (texte et couleurs) et ses réglages sont envoyés au serveur pour que d’autres votent, avec une image de celui-ci (son titre et ses éléments, dessinée par ton navigateur) qui s’affiche quand son lien est collé quelque part ; partager un duel en dessine une de ce duel aussi. Quand l’éditeur le permet, les images de tes éléments sont envoyées aussi, gardées pour la relecture de l’éditeur et montrées aux votants seulement une fois validées ; une image refusée est supprimée. Chaque vote est enregistré avec l’identifiant anonyme du navigateur qui l’a donné, la paire, le choix et l’heure : ni nom, ni e-mail, ni adresse IP.',
  boards2:
    'Un classement publié est supprimé quand son auteur le retire, ou après {days} jours sans activité. Toute personne qui a son lien peut le voir et voter : n’y publie rien de personnel. Le lien de l’auteur porte une clé après le <code>#</code>, que les navigateurs n’envoient jamais à un serveur : garde-le pour toi.',
  boards3:
    'Signaler un classement envoie le motif que tu choisis, ta précision s’il y en a une, et le même identifiant anonyme de votant, pour qu’un navigateur ne compte qu’une fois ; l’éditeur lit les signalements pour décider de retirer un classement, de le masquer des listes du site ou de le laisser. Rien d’autre n’est gardé sur toi.',

  countTitle: 'Mesure d’audience',
  count1:
    'Les visites sont comptées avec <a href="https://umami.is">Umami</a>, auto-hébergé sur un serveur de l’éditeur à l’adresse <code>insight.steevepommier.com</code> : aucun tiers ne reçoit les données, et rien ne sert à la publicité.',
  count2:
    '<b>Ce qui est compté :</b> les pages vues, où ce qui identifie un classement ou un classement publié est remplacé par un repère (<code>/app/r/:id</code>) ; le site d’où tu viens ; quelques événements anonymes (un classement créé ou terminé, un classement publié, un premier vote sur un classement publié et toutes ses paires votées, un résultat ou un duel partagé en image et par quel moyen, une installation, un camp choisi dans le débat de la chocolatine) ; ton navigateur, ton système, le type d’appareil, la taille d’écran, la langue et le pays.',
  count3:
    '<b>Ce qui ne l’est jamais :</b> le contenu de tes classements, leurs titres ou leurs éléments, l’adresse d’un classement publié, la clé de l’auteur, ton adresse IP (elle donne le pays, puis est oubliée), ni rien qui puisse te suivre d’un site à l’autre. Aucun cookie n’est déposé.',
  count4:
    'Le compteur n’est même pas chargé quand ton navigateur envoie <i>Do Not Track</i> ou <i>Global Privacy Control</i>, ou quand tu le coupes ci-dessous ; ce choix est gardé dans ce navigateur.',
  countOn: 'Tes visites sont comptées, anonymement, dans ce navigateur.',
  countOff: 'Tes visites ne sont pas comptées dans ce navigateur.',
  countSignal: 'Ton navigateur demande à ne pas être suivi : tes visites ne sont pas comptées.',
  countNone: 'Cette copie de Versus ne compte pas les visites.',
  countStop: 'Ne plus compter mes visites',
  countResume: 'Compter à nouveau mes visites',

  cookiesTitle: 'Cookies',
  cookies1:
    'Versus ne dépose aucun cookie, donc pas de bandeau de consentement : il n’y a rien à accepter. Quand la publication demande une vérification anti-robots, Cloudflare Turnstile s’exécute dans ton navigateur, selon la politique de confidentialité de Cloudflare.',

  logsTitle: 'Hébergement et abus',
  logs1:
    'Comme tout hébergeur, Cloudflare (et GitHub pour la copie) traite ton adresse IP pour délivrer les pages et protéger le site : voir la <a href="https://www.cloudflare.com/privacypolicy/">politique de confidentialité de Cloudflare</a>. Versus s’en sert, sans la garder, pour limiter la fréquence à laquelle une même adresse peut publier ou appeler le serveur, et garde quelques jours des journaux techniques des appels au serveur pour corriger les erreurs.',

  rightsTitle: 'Tes droits',
  rights1:
    'Le RGPD te permet de demander l’accès aux données qui te concernent ou leur effacement. Versus n’en garde aucune qui te nomme : tes classements sont sur ton appareil, et les votes publiés ne portent qu’un identifiant anonyme. Pour toute question ou demande, écris à {email} ; tu peux aussi adresser une réclamation à la <a href="https://www.cnil.fr">CNIL</a>.',

  licenceTitle: 'Licence et contenus',
  licence1:
    'Versus est un logiciel libre : son <a href="{source}">code source</a> est publié sous <a href="{license}">licence MIT</a>.',
  licence2:
    'Ce que tu mets dans Versus reste à toi. Quand tu publies un classement, tu en es responsable et tu dois avoir le droit de partager ce qu’il contient. Quelque chose d’illégal ou de choquant dans un classement publié ? Utilise son bouton <b>Signaler</b>, ou envoie son lien à {email}, et il sera retiré.',

  liabTitle: 'Responsabilité',
  liab1:
    'Versus est fourni tel quel, de bonne foi, sans garantie d’aucune sorte : un classement est une opinion faite de duels, pas un fait. Les liens vers d’autres sites sont donnés par commodité ; leur contenu leur appartient.',
};

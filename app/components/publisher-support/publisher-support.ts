import { CommonModule } from '@angular/common';
import { animate, state, style, transition, trigger } from '@angular/animations';
import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { take } from 'rxjs';
import { TranslationService } from '../../core/i18n/translation.service';
import { FaqService } from '../../core/services/faq.service';
import { PublisherHeaderComponent } from '../publisher-header/publisher-header';
import { PublisherContentService, PublisherContentType } from '../../services/publisher-content.service';

type SupportFormField = 'name' | 'email' | 'message';
type SupportCategoryId = 'all' | 'approval' | 'content' | 'media' | 'reviews' | 'map' | 'account';

interface SupportCategory {
  id: SupportCategoryId;
  label: string;
  summary: string;
  icon: string;
}

interface SupportArticle {
  id: string;
  categoryId: Exclude<SupportCategoryId, 'all'>;
  icon: string;
  title: string;
  summary: string;
  badge: string;
  answer: string[];
  checklist: string[];
  actionLabel?: string;
  actionRoute?: string;
}

@Component({
  selector: 'app-publisher-support',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, PublisherHeaderComponent],
  templateUrl: './publisher-support.html',
  styleUrl: './publisher-support.css',
  animations: [
    trigger('expandCollapse', [
      state('collapsed', style({
        height: '0px',
        opacity: 0,
        marginTop: '0px',
        paddingTop: '0px',
        paddingBottom: '0px',
        overflow: 'hidden',
      })),
      state('expanded', style({
        height: '*',
        opacity: 1,
        marginTop: '*',
        paddingTop: '*',
        paddingBottom: '*',
        overflow: 'hidden',
      })),
      transition('collapsed <=> expanded', animate('180ms ease')),
    ]),
  ],
})
export class PublisherSupportComponent implements OnInit {
  readonly MESSAGE_MAX_LENGTH = 2000;

  readonly contentType = signal<PublisherContentType>('Object');
  readonly selectedCategory = signal<SupportCategoryId>('all');
  readonly searchTerm = signal('');
  readonly expandedId = signal<string | null>('approval-status');
  readonly isSupportSending = signal(false);
  readonly supportStatus = signal<string | null>(null);
  readonly supportStatusTone = signal<'success' | 'error' | null>(null);

  readonly supportForm = signal({
    name: '',
    email: '',
    message: ''
  });

  readonly copy = computed(() => {
    const sr = this.isSerbian();
    return sr
      ? {
          eyebrow: 'Centar za pomoć izdavača',
          title: 'Brza pomoć za objavljivanje i održavanje sadržaja',
          subtitle: 'Pronađite konkretne odgovore za odobravanje sadržaja, slike, lokaciju, recenzije i izmene koje najčešće koče objavu.',
          responseTime: 'Tipičan odgovor',
          responseWindow: 'u toku radnog dana',
          searchLabel: 'Pretraga pomoći',
          searchPlaceholder: 'Pretraži: slike, odbijeno, mapa, recenzije...',
          topicsTitle: 'Izaberite temu',
          allArticles: 'Svi vodiči',
          articlesCount: 'vodiča',
          firstChecksTitle: 'Prvo proverite',
          firstChecks: [
            'Da li je element poslat na odobrenje i koji status piše u tabeli.',
            'Da li su lokacija i destinacija usklađene sa mapom.',
            'Da li su slike jasne, relevantne i u podržanom formatu.',
            'Da li je tekst dovoljno konkretan za turistu koji odlučuje gde ide.'
          ],
          answersTitle: 'Konkretni odgovori',
          noResultsTitle: 'Nema poklapanja',
          noResultsText: 'Probajte kraći pojam ili izaberite drugu temu.',
          contactEyebrow: 'Direktna podrška',
          contactTitle: 'Pošaljite poruku timu',
          contactText: 'Najbrže rešavamo prijave koje imaju naziv elementa, status i kratak opis šta ste pokušali.',
          organizationName: 'Naziv organizacije',
          email: 'E-mail',
          message: 'Poruka',
          messagePlaceholder: 'Primer: Element "Hotel Moskva" je odbijen, izmenio sam opis i slike, ali nisam siguran šta još nedostaje...',
          send: 'Pošalji zahtev',
          sending: 'Slanje...',
          success: 'Zahtev je poslat. Tim podrške će proveriti slučaj.',
          error: 'Zahtev trenutno nije mogao da se pošalje. Pokušajte ponovo.',
          open: 'Otvori',
          close: 'Zatvori'
        }
      : {
          eyebrow: 'Publisher help center',
          title: 'Practical help for publishing and maintaining content',
          subtitle: 'Find focused answers about approvals, images, map placement, reviews, and the edits that most often block publishing.',
          responseTime: 'Typical response',
          responseWindow: 'within one business day',
          searchLabel: 'Search help',
          searchPlaceholder: 'Search: images, rejected, map, reviews...',
          topicsTitle: 'Choose a topic',
          allArticles: 'All guides',
          articlesCount: 'guides',
          firstChecksTitle: 'Check this first',
          firstChecks: [
            'Whether the item was submitted and which status appears in the table.',
            'Whether location and destination match the map boundary.',
            'Whether images are clear, relevant, and in a supported format.',
            'Whether the description is specific enough for a tourist making a decision.'
          ],
          answersTitle: 'Useful answers',
          noResultsTitle: 'No matches',
          noResultsText: 'Try a shorter search term or another topic.',
          contactEyebrow: 'Direct support',
          contactTitle: 'Send a message to the team',
          contactText: 'The fastest requests include the content title, current status, and a short note about what you already tried.',
          organizationName: 'Organization name',
          email: 'Email',
          message: 'Message',
          messagePlaceholder: 'Example: "Hotel Moskva" was rejected. I updated the description and images, but I am not sure what is still missing...',
          send: 'Send request',
          sending: 'Sending...',
          success: 'Your request has been sent. The support team will review it.',
          error: 'The request could not be sent right now. Please try again.',
          open: 'Open',
          close: 'Close'
        };
  });

  readonly categories = computed<SupportCategory[]>(() => {
    const sr = this.isSerbian();
    return sr
      ? [
          { id: 'all', label: 'Sve', summary: 'Kompletna pomoć', icon: 'pi pi-th-large' },
          { id: 'approval', label: 'Odobravanje', summary: 'Pending, rejected i resubmit', icon: 'pi pi-verified' },
          { id: 'content', label: 'Unos sadržaja', summary: 'Šta unos mora da ima', icon: 'pi pi-file-edit' },
          { id: 'media', label: 'Slike', summary: 'Dodavanje, zamena i kvalitet', icon: 'pi pi-images' },
          { id: 'reviews', label: 'Recenzije', summary: 'Komentari, ocene i analitika', icon: 'pi pi-chart-line' },
          { id: 'map', label: 'Mapa', summary: 'Destinacija, pin i vidljivost', icon: 'pi pi-compass' },
          { id: 'account', label: 'Nalog', summary: 'Profil, jezik i kontakt', icon: 'pi pi-user' }
        ]
      : [
          { id: 'all', label: 'All', summary: 'Complete help', icon: 'pi pi-th-large' },
          { id: 'approval', label: 'Approvals', summary: 'Pending, rejected, resubmit', icon: 'pi pi-verified' },
          { id: 'content', label: 'Content entry', summary: 'What each entry needs', icon: 'pi pi-file-edit' },
          { id: 'media', label: 'Images', summary: 'Upload, replace, quality', icon: 'pi pi-images' },
          { id: 'reviews', label: 'Reviews', summary: 'Comments, ratings, analytics', icon: 'pi pi-chart-line' },
          { id: 'map', label: 'Map', summary: 'Destination, pin, visibility', icon: 'pi pi-compass' },
          { id: 'account', label: 'Account', summary: 'Profile, language, contact', icon: 'pi pi-user' }
        ];
  });

  readonly articles = computed<SupportArticle[]>(() => this.buildArticles());

  readonly filteredArticles = computed(() => {
    const category = this.selectedCategory();
    const query = this.searchTerm().trim().toLowerCase();

    return this.articles().filter(article => {
      const matchesCategory = category === 'all' || article.categoryId === category;
      if (!matchesCategory) return false;
      if (!query) return true;

      const text = [
        article.title,
        article.summary,
        article.badge,
        ...article.answer,
        ...article.checklist
      ].join(' ').toLowerCase();

      return text.includes(query);
    });
  });

  readonly canSubmitSupport = computed(() => {
    const form = this.supportForm();
    return (
      !!form.name.trim() &&
      !!form.email.trim() &&
      !!form.message.trim() &&
      !this.isSupportSending()
    );
  });

  constructor(
    private readonly faqService: FaqService,
    private readonly publisherContentService: PublisherContentService,
    private readonly translation: TranslationService
  ) {}

  ngOnInit(): void {
    this.prefillSupportForm();
    this.publisherContentService.getCurrentPublisherContentType().pipe(take(1)).subscribe({
      next: (contentType) => this.contentType.set(contentType),
      error: () => {}
    });
  }

  setCategory(category: SupportCategoryId): void {
    this.selectedCategory.set(category);
    this.expandedId.set(this.filteredArticles()[0]?.id ?? null);
  }

  onSearchTermChange(value: string): void {
    this.searchTerm.set(value);
    this.expandedId.set(this.filteredArticles()[0]?.id ?? null);
  }

  toggle(itemId: string): void {
    this.expandedId.set(this.expandedId() === itemId ? null : itemId);
  }

  categoryCount(categoryId: SupportCategoryId): number {
    if (categoryId === 'all') {
      return this.articles().length;
    }
    return this.articles().filter(article => article.categoryId === categoryId).length;
  }

  updateSupportField(field: SupportFormField, value: string): void {
    if (field === 'message') {
      value = value.slice(0, this.MESSAGE_MAX_LENGTH);
    }
    this.supportForm.update(current => ({ ...current, [field]: value }));
    this.supportStatus.set(null);
    this.supportStatusTone.set(null);
  }

  submitSupportRequest(): void {
    if (!this.canSubmitSupport()) return;

    this.isSupportSending.set(true);
    this.supportStatus.set(null);
    this.supportStatusTone.set(null);

    this.faqService.sendSupportRequest(this.supportForm()).subscribe({
      next: () => {
        this.isSupportSending.set(false);
        this.supportStatus.set(this.copy().success);
        this.supportStatusTone.set('success');
        this.supportForm.update(current => ({ ...current, message: '' }));
      },
      error: () => {
        this.isSupportSending.set(false);
        this.supportStatus.set(this.copy().error);
        this.supportStatusTone.set('error');
      }
    });
  }

  private prefillSupportForm(): void {
    this.publisherContentService.getUserProfile().pipe(take(1)).subscribe({
      next: (userProfile: any) => {
        const orgName = userProfile?.publisherProfile?.organizationName ?? '';
        const email = userProfile?.email ?? '';
        this.supportForm.update(current => ({
          ...current,
          name: orgName,
          email: email
        }));
      },
      error: () => {}
    });
  }

  private buildArticles(): SupportArticle[] {
    const sr = this.isSerbian();
    const contentSingular = this.contentTypeLabel(false);
    const contentPlural = this.contentTypeLabel(true);
    const typeSpecificChecklist = this.typeSpecificChecklist();

    if (sr) {
      return [
        {
          id: 'approval-status',
          categoryId: 'approval',
          icon: 'pi pi-hourglass',
          title: 'Šta znači status Pending Approval?',
          summary: 'Element je sačuvan i čeka proveru administratora destinacije.',
          badge: 'Status',
          answer: [
            `Kada pošaljete ${contentSingular}, status Pending Approval znači da je unos stigao do administratora i da još nije javno vidljiv turistima.`,
            'U tabeli Moj sadržaj možete pratiti trenutni status. Ako je element odobren, pojaviće se na mapi i u rezultatima. Ako je odbijen, razlog će biti prikazan u istoj tabeli.'
          ],
          checklist: [
            'Ne pravite duplikat istog elementa dok je jedan već pending.',
            'Proverite da li naslov, destinacija, tip i lokacija imaju smisla zajedno.',
            'Ako dugo stoji pending, pošaljite poruku podršci sa nazivom elementa.'
          ],
          actionLabel: 'Otvori Moj sadržaj',
          actionRoute: '/publisher-my-content'
        },
        {
          id: 'rejected-content',
          categoryId: 'approval',
          icon: 'pi pi-exclamation-triangle',
          title: 'Šta da radim kada je sadržaj odbijen?',
          summary: 'Prvo pročitajte razlog odbijanja, zatim izmenite samo problematične delove.',
          badge: 'Rejected',
          answer: [
            'Odbijanje najčešće znači da administratoru nedostaje jasan opis, tačna lokacija, dobra slika ili validan link. Nije potrebno unositi sve ispočetka.',
            'Kliknite Edit, ispravite navedeni problem i ponovo sačuvajte sadržaj. Posle izmene element ponovo ide u proveru.'
          ],
          checklist: [
            'Opis treba da objasni šta turista zaista dobija ili vidi.',
            'Pin na mapi mora biti unutar izabrane destinacije.',
            'Slike treba da prikazuju stvarni objekat, aktivnost ili događaj.',
            'Linkovi moraju početi sa http:// ili https://.'
          ],
          actionLabel: 'Pregledaj statuse',
          actionRoute: '/publisher-my-content'
        },
        {
          id: 'content-quality',
          categoryId: 'content',
          icon: 'pi pi-file-check',
          title: `Šta mora da ima dobar unos za ${contentPlural}?`,
          summary: 'Dobar unos je konkretan, proverljiv i koristan turistima.',
          badge: 'Kvalitet unosa',
          answer: [
            `Za ${contentPlural} je najvažnije da turista brzo razume gde se nalazi, šta dobija i zašto vredi posetiti.`,
            'Kratak generički opis deluje nepoverljivo. Bolje je navesti konkretne detalje: lokaciju, iskustvo, trajanje, cenu, kapacitet, kontakt ili uslove dolaska.'
          ],
          checklist: typeSpecificChecklist,
          actionLabel: 'Dodaj novi sadržaj',
          actionRoute: '/publisher-add-new-content'
        },
        {
          id: 'image-workflow',
          categoryId: 'media',
          icon: 'pi pi-images',
          title: 'Kako da dodam ili zamenim slike?',
          summary: 'Publisher sada koristi isti tok slika kao admin: više slika, uklanjanje i zadržavanje postojećih.',
          badge: 'Slike',
          answer: [
            'Možete dodati do 15 slika po elementu. Podržani su JPG, PNG i WebP formati.',
            'Postojeće slike se čuvaju dok ih sami ne uklonite. Kada dodate nove slike, sistem šalje i zadržane slike i nove fajlove, tako da se galerija ne briše slučajno.'
          ],
          checklist: [
            'Prva slika treba da bude najprepoznatljivija, jer se koristi kao glavna u prikazima.',
            'Ne koristite mutne, tamne ili generičke stock fotografije.',
            'Za uklanjanje kliknite x na konkretnoj slici, a za dodavanje koristite + karticu.',
            'Ako slika ne prolazi, proverite format i veličinu fajla.'
          ],
          actionLabel: 'Otvori sadržaj',
          actionRoute: '/publisher-my-content'
        },
        {
          id: 'map-placement',
          categoryId: 'map',
          icon: 'pi pi-map-marker',
          title: 'Kako da znam da je lokacija dobro postavljena?',
          summary: 'Destinacija se bira prvo, zatim se pin postavlja unutar granica te destinacije.',
          badge: 'Mapa',
          answer: [
            'Mapa ograničava izbor lokacije na izabranu destinaciju. Ako pin ne može da se postavi, najčešće destinacija nije izabrana ili pokušavate da kliknete van dozvoljene zone.',
            'Za aktivnosti i događaje koji su vezani za postojeći objekat, lokacija može biti preuzeta iz tog objekta kako bi prikaz bio dosledan.'
          ],
          checklist: [
            'Prvo izaberite destinaciju.',
            'Koristite pretragu lokacije ili ručno kliknite na mapu.',
            'Proverite da li je adresa/pin logičan u odnosu na naziv elementa.',
            'Ako lokacija nije precizna, bolje je pomeriti pin nego slati nejasan unos.'
          ],
          actionLabel: 'Otvori mapu',
          actionRoute: '/publisher-map'
        },
        {
          id: 'reviews-dashboard',
          categoryId: 'reviews',
          icon: 'pi pi-chart-line',
          title: 'Kako da koristim stranicu Recenzije?',
          summary: 'Recenzije su sada organizovane po elementima, sa analitikom i popup pregledom.',
          badge: 'Analitika',
          answer: [
            'Gornji deo prikazuje ukupan broj recenzija, prosečnu ocenu, najaktivniji mesec i najbolje ocenjen sadržaj.',
            'Kartice ispod prikazuju svaki vaš element. Klik na Prikaži recenzije otvara popup u kome možete sortirati komentare i filtrirati po oceni.'
          ],
          checklist: [
            'Gledajte mesečni grafikon da vidite kada dobijate najviše povratnih informacija.',
            'Uporedite najrecenziraniji i najbolje ocenjen element.',
            'Lošije ocene koristite kao listu stvari koje treba popraviti u opisu, ceni, usluzi ili očekivanjima.'
          ],
          actionLabel: 'Otvori Recenzije',
          actionRoute: '/publisher-reviews'
        },
        {
          id: 'language-profile',
          categoryId: 'account',
          icon: 'pi pi-language',
          title: 'Kako menjam jezik i podatke naloga?',
          summary: 'EN/SR prekidač je u publisher header-u, a profil je desno.',
          badge: 'Nalog',
          answer: [
            'Jezik možete promeniti direktno u gornjem delu publisher interfejsa klikom na EN ili SR.',
            'Za podatke profila otvorite dugme profila desno. Ako ne možete da izmenite poslovni podatak koji utiče na odobrenje naloga, pošaljite zahtev podršci.'
          ],
          checklist: [
            'Promena jezika se pamti u browseru.',
            'Ako deo teksta ostane na starom jeziku, osvežite stranicu.',
            'Za promenu organizacije, telefona ili sajta navedite tačne nove podatke u poruci podršci.'
          ]
        },
        {
          id: 'contact-support',
          categoryId: 'account',
          icon: 'pi pi-send',
          title: 'Kada ima smisla pisati podršci?',
          summary: 'Pišite kada imate konkretan problem koji ne možete rešiti iz edit forme.',
          badge: 'Kontakt',
          answer: [
            'Najkorisnije prijave su kratke i konkretne: naziv elementa, trenutni status, šta ste promenili i šta očekujete da se desi.',
            'Ako je problem oko slike, statusa ili lokacije, napišite naziv elementa tačno kao u tabeli Moj sadržaj.'
          ],
          checklist: [
            'Navedite naziv elementa.',
            'Navedite status: Pending, Approved ili Rejected.',
            'Opišite šta ste pokušali.',
            'Ako se problem ponavlja, navedite datum i vreme kada se desio.'
          ]
        }
      ];
    }

    return [
      {
        id: 'approval-status',
        categoryId: 'approval',
        icon: 'pi pi-hourglass',
        title: 'What does Pending Approval mean?',
        summary: 'The item is saved and waiting for a destination admin review.',
        badge: 'Status',
        answer: [
          `When you submit an ${contentSingular}, Pending Approval means the entry reached the admin team and is not public yet.`,
          'Use My Content to track the current status. Approved items can appear on the map and in results. Rejected items show the rejection reason in the same table.'
        ],
        checklist: [
          'Do not create a duplicate while the same item is already pending.',
          'Check that title, destination, type, and location belong together.',
          'If an item stays pending for too long, contact support with the exact title.'
        ],
        actionLabel: 'Open My Content',
        actionRoute: '/publisher-my-content'
      },
      {
        id: 'rejected-content',
        categoryId: 'approval',
        icon: 'pi pi-exclamation-triangle',
        title: 'What should I do when content is rejected?',
        summary: 'Read the rejection reason first, then edit only the parts that need work.',
        badge: 'Rejected',
        answer: [
          'Rejection usually means the admin needs a clearer description, a correct map pin, a better image, or a valid link. You do not need to recreate the item.',
          'Click Edit, fix the issue, and save again. The item will go back into review.'
        ],
        checklist: [
          'The description should explain what the tourist actually gets or sees.',
          'The map pin must be inside the selected destination.',
          'Images should show the real object, activity, or event.',
          'Links must start with http:// or https://.'
        ],
        actionLabel: 'Review statuses',
        actionRoute: '/publisher-my-content'
      },
      {
        id: 'content-quality',
        categoryId: 'content',
        icon: 'pi pi-file-check',
        title: `What makes a good ${contentSingular} entry?`,
        summary: 'A good entry is concrete, verifiable, and useful to tourists.',
        badge: 'Entry quality',
        answer: [
          `For ${contentPlural}, tourists need to understand where it is, what they get, and why it is worth visiting.`,
          'A short generic description is weak. Specific details like location, experience, duration, price, capacity, contact, or arrival conditions make the entry easier to approve and easier to trust.'
        ],
        checklist: typeSpecificChecklist,
        actionLabel: 'Add new content',
        actionRoute: '/publisher-add-new-content'
      },
      {
        id: 'image-workflow',
        categoryId: 'media',
        icon: 'pi pi-images',
        title: 'How do I add or replace images?',
        summary: 'Publisher image editing now uses the same flow as admin content: multiple images, removals, and retained images.',
        badge: 'Images',
        answer: [
          'You can add up to 15 images per item. JPG, PNG, and WebP are supported.',
          'Existing images are kept until you remove them. When you add new images, the app sends both retained URLs and new files, so the gallery is not wiped by accident.'
        ],
        checklist: [
          'Use the most recognizable image first because it works as the main visual.',
          'Avoid blurry, dark, or generic stock-like photos.',
          'Click x on a specific image to remove it, and use the + card to add more.',
          'If an upload fails, check the file format and size.'
        ],
        actionLabel: 'Open content',
        actionRoute: '/publisher-my-content'
      },
      {
        id: 'map-placement',
        categoryId: 'map',
        icon: 'pi pi-map-marker',
        title: 'How do I know the location is correct?',
        summary: 'Select a destination first, then place the pin inside that destination boundary.',
        badge: 'Map',
        answer: [
          'The map limits placement to the selected destination. If a pin cannot be placed, the destination is probably missing or the click is outside the allowed zone.',
          'For activities and events linked to an existing object, the location can be inherited from that object to keep listings consistent.'
        ],
        checklist: [
          'Choose the destination first.',
          'Use location search or click directly on the map.',
          'Check that the address/pin matches the item title.',
          'If the location is imprecise, move the pin before submitting.'
        ],
        actionLabel: 'Open map',
        actionRoute: '/publisher-map'
      },
      {
        id: 'reviews-dashboard',
        categoryId: 'reviews',
        icon: 'pi pi-chart-line',
        title: 'How should I use the Reviews page?',
        summary: 'Reviews are now grouped by content, with analytics and a popup review list.',
        badge: 'Analytics',
        answer: [
          'The top area shows total reviews, average rating, busiest month, and best-rated content.',
          'The cards below show each item you own. Show reviews opens a popup where you can sort comments and filter by rating.'
        ],
        checklist: [
          'Use the monthly chart to see when feedback is strongest.',
          'Compare your most reviewed item with your best-rated item.',
          'Use lower ratings as a practical list of what to improve in description, price, service, or expectations.'
        ],
        actionLabel: 'Open Reviews',
        actionRoute: '/publisher-reviews'
      },
      {
        id: 'language-profile',
        categoryId: 'account',
        icon: 'pi pi-language',
        title: 'How do I change language and profile data?',
        summary: 'The EN/SR switch is in the publisher header, and profile settings are on the right.',
        badge: 'Account',
        answer: [
          'Change language from the top publisher header by clicking EN or SR.',
          'Open the profile button on the right for profile data. If a business detail affects account approval and cannot be edited directly, send a support request.'
        ],
        checklist: [
          'Language preference is remembered in this browser.',
          'If a section keeps the previous language, refresh the page.',
          'For organization, phone, or website changes, include the exact new values in your support message.'
        ]
      },
      {
        id: 'contact-support',
        categoryId: 'account',
        icon: 'pi pi-send',
        title: 'When should I contact support?',
        summary: 'Contact support when a specific issue cannot be solved from the edit form.',
        badge: 'Contact',
        answer: [
          'The most useful requests are short and specific: content title, current status, what you changed, and what you expected to happen.',
          'If the problem is about an image, status, or location, write the title exactly as it appears in My Content.'
        ],
        checklist: [
          'Include the item title.',
          'Include the status: Pending, Approved, or Rejected.',
          'Describe what you already tried.',
          'If it repeats, include the date and time when it happened.'
        ]
      }
    ];
  }

  private typeSpecificChecklist(): string[] {
    const sr = this.isSerbian();

    switch (this.contentType()) {
      case 'Activity':
        return sr
          ? [
              'Unesite realno trajanje aktivnosti u minutima.',
              'Ako je aktivnost vezana za objekat, izaberite taj objekat.',
              'Cena i valuta treba da budu jasne, čak i kada je aktivnost besplatna.',
              'Opis treba da kaže kome je aktivnost namenjena i šta je uključeno.'
            ]
          : [
              'Enter a realistic duration in minutes.',
              'If the activity belongs to an object, select that object.',
              'Price and currency should be clear, even when the activity is free.',
              'The description should say who it is for and what is included.'
            ];
      case 'Event':
        return sr
          ? [
              'Izaberite povezani objekat jer događaj mora imati mesto održavanja.',
              'Početak događaja mora biti u budućnosti.',
              'Ako postoji kraj događaja, mora biti posle početka.',
              'Kapacitet, cena i opis treba da postave realna očekivanja.'
            ]
          : [
              'Select the related object because an event needs a venue.',
              'The event start date must be in the future.',
              'If an end date exists, it must be after the start date.',
              'Capacity, price, and description should set realistic expectations.'
            ];
      default:
        return sr
          ? [
              'Izaberite tačan tip objekta i destinaciju.',
              'Dodajte adresu/pin koji turista može stvarno da pronađe.',
              'Ako imate telefon, website, Booking ili Airbnb link, unesite validan URL.',
              'Opis treba da kaže šta je posebno, kome odgovara i šta posetilac treba da zna.'
            ]
          : [
              'Choose the correct object type and destination.',
              'Add an address/pin a tourist can actually find.',
              'If you provide phone, website, Booking, or Airbnb links, use valid URLs.',
              'The description should explain what is special, who it suits, and what visitors should know.'
            ];
    }
  }

  private contentTypeLabel(plural: boolean): string {
    const sr = this.isSerbian();

    switch (this.contentType()) {
      case 'Activity':
        return sr ? (plural ? 'aktivnosti' : 'aktivnost') : (plural ? 'activities' : 'activity');
      case 'Event':
        return sr ? (plural ? 'događaje' : 'događaj') : (plural ? 'events' : 'event');
      default:
        return sr ? (plural ? 'objekte' : 'objekat') : (plural ? 'objects' : 'object');
    }
  }

  private isSerbian(): boolean {
    return this.translation.currentLanguage() === 'sr';
  }
}
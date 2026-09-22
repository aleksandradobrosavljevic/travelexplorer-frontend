import { CommonModule } from '@angular/common';
import { animate, state, style, transition, trigger } from '@angular/animations';
import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { take } from 'rxjs';
import { FaqService } from '../../core/services/faq.service';
import { buildApiUrl } from '../../core/config/api';
import { HeaderComponent } from '../header/header';
import { TranslationService } from '../../core/i18n/translation.service';
import { AuthState } from '../../core/services/auth-state.service';

type SupportFormField = 'name' | 'email' | 'message';
type TouristSupportCategoryId = 'all' | 'discover' | 'map' | 'favourites' | 'reviews' | 'account' | 'booking';

interface TouristSupportCategory {
  id: TouristSupportCategoryId;
  label: string;
  summary: string;
  icon: string;
}

interface TouristSupportArticle {
  id: string;
  categoryId: Exclude<TouristSupportCategoryId, 'all'>;
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
  selector: 'app-faq-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, HeaderComponent],
  templateUrl: './faq-page.html',
  styleUrl: './faq-page.css',
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
export class FaqPageComponent implements OnInit {
  readonly selectedCategory = signal<TouristSupportCategoryId>('all');
  readonly searchTerm = signal('');
  readonly expandedId = signal<string | null>('choose-destination');
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
          eyebrow: 'Centar pomoći za turiste',
          title: 'Praktična pomoć za planiranje posete',
          subtitle: 'Brzi odgovori za destinacije, mapu, omiljena mesta, recenzije, profil i situacije koje najčešće zaustave pretragu.',
          responseTime: 'Tipičan odgovor',
          responseWindow: 'u toku radnog dana',
          searchLabel: 'Pretraga pomoći',
          searchPlaceholder: 'Pretraži: destinacija, mapa, omiljeno, recenzije...',
          topicsTitle: 'Izaberite temu',
          allArticles: 'Svi vodiči',
          articlesCount: 'vodiča',
          firstChecksTitle: 'Prvo proverite',
          firstChecks: [
            'Da li ste izabrali destinaciju ako želite da vidite sadržaj za konkretno mesto.',
            'Da li su filteri na mapi ili početnoj strani previše suženi.',
            'Da li ste prijavljeni ako želite da čuvate omiljeno ili pišete recenzije.',
            'Da li je dozvoljen pristup lokaciji ako želite rutu od trenutne pozicije.'
          ],
          answersTitle: 'Konkretni odgovori',
          noResultsTitle: 'Nema poklapanja',
          noResultsText: 'Probajte kraći pojam ili izaberite drugu temu.',
          contactEyebrow: 'Direktna podrška',
          contactTitle: 'Pošaljite poruku timu',
          contactText: 'Najbrže rešavamo prijave koje imaju naziv destinacije ili elementa, šta ste pokušali i šta se desilo.',
          name: 'Ime',
          email: 'E-mail',
          message: 'Poruka',
          messagePlaceholder: 'Primer: Izabrao sam Beograd, ali ne vidim aktivnosti na mapi. Probao sam da obrišem filtere...',
          send: 'Pošalji zahtev',
          sending: 'Slanje...',
          success: 'Zahtev je poslat. Tim podrške će proveriti slučaj.',
          error: 'Zahtev trenutno nije mogao da se pošalje. Pokušajte ponovo.',
          open: 'Otvori',
          close: 'Zatvori'
        }
      : {
          eyebrow: 'Tourist help center',
          title: 'Practical help for planning your visit',
          subtitle: 'Quick answers for destinations, the map, favourites, reviews, profile settings, and the issues that most often block discovery.',
          responseTime: 'Typical response',
          responseWindow: 'within one business day',
          searchLabel: 'Search help',
          searchPlaceholder: 'Search: destination, map, favourites, reviews...',
          topicsTitle: 'Choose a topic',
          allArticles: 'All guides',
          articlesCount: 'guides',
          firstChecksTitle: 'Check this first',
          firstChecks: [
            'Whether you selected a destination if you want content for a specific place.',
            'Whether map or home filters are too narrow.',
            'Whether you are signed in before saving favourites or writing reviews.',
            'Whether location access is allowed if you want a route from your current position.'
          ],
          answersTitle: 'Useful answers',
          noResultsTitle: 'No matches',
          noResultsText: 'Try a shorter search term or another topic.',
          contactEyebrow: 'Direct support',
          contactTitle: 'Send a message to the team',
          contactText: 'The fastest requests include the destination or item name, what you tried, and what happened.',
          name: 'Name',
          email: 'Email',
          message: 'Message',
          messagePlaceholder: 'Example: I selected Belgrade, but I cannot see activities on the map. I tried clearing filters...',
          send: 'Send request',
          sending: 'Sending...',
          success: 'Your request has been sent. The support team will review it.',
          error: 'The request could not be sent right now. Please try again.',
          open: 'Open',
          close: 'Close'
        };
  });

  readonly categories = computed<TouristSupportCategory[]>(() => {
    const sr = this.isSerbian();
    return sr
      ? [
          { id: 'all', label: 'Sve', summary: 'Kompletna pomoć', icon: 'pi pi-th-large' },
          { id: 'discover', label: 'Destinacije', summary: 'Pretraga i izbor mesta', icon: 'pi pi-map-marker' },
          { id: 'map', label: 'Mapa', summary: 'Filteri, rute i lokacija', icon: 'pi pi-compass' },
          { id: 'favourites', label: 'Omiljeno', summary: 'Čuvanje i pregled', icon: 'pi pi-heart' },
          { id: 'reviews', label: 'Recenzije', summary: 'Ocene i komentari', icon: 'pi pi-star' },
          { id: 'booking', label: 'Rezervacije', summary: 'Linkovi, cene i dostupnost', icon: 'pi pi-ticket' },
          { id: 'account', label: 'Nalog', summary: 'Profil, jezik i slika', icon: 'pi pi-user' }
        ]
      : [
          { id: 'all', label: 'All', summary: 'Complete help', icon: 'pi pi-th-large' },
          { id: 'discover', label: 'Destinations', summary: 'Search and place selection', icon: 'pi pi-map-marker' },
          { id: 'map', label: 'Map', summary: 'Filters, routes, location', icon: 'pi pi-compass' },
          { id: 'favourites', label: 'Favourites', summary: 'Saving and browsing', icon: 'pi pi-heart' },
          { id: 'reviews', label: 'Reviews', summary: 'Ratings and comments', icon: 'pi pi-star' },
          { id: 'booking', label: 'Bookings', summary: 'Links, prices, availability', icon: 'pi pi-ticket' },
          { id: 'account', label: 'Account', summary: 'Profile, language, photo', icon: 'pi pi-user' }
        ];
  });

  readonly articles = computed<TouristSupportArticle[]>(() => this.buildArticles());

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
    return !!form.name.trim() && !!form.email.trim() && !!form.message.trim() && !this.isSupportSending();
  });

  constructor(
    private readonly faqService: FaqService,
    private readonly http: HttpClient,
    private readonly translation: TranslationService,
    private readonly authState: AuthState
  ) {}

  ngOnInit(): void {
    this.prefillSupportForm();
  }

  setCategory(category: TouristSupportCategoryId): void {
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

  categoryCount(categoryId: TouristSupportCategoryId): number {
    if (categoryId === 'all') {
      return this.articles().length;
    }

    return this.articles().filter(article => article.categoryId === categoryId).length;
  }

  updateSupportField(field: SupportFormField, value: string): void {
    this.supportForm.update((current) => ({
      ...current,
      [field]: value
    }));
    this.supportStatus.set(null);
    this.supportStatusTone.set(null);
  }

  submitSupportRequest(): void {
    if (!this.canSubmitSupport()) {
      return;
    }

    this.isSupportSending.set(true);
    this.supportStatus.set(null);
    this.supportStatusTone.set(null);

    this.faqService.sendSupportRequest(this.supportForm()).subscribe({
      next: () => {
        this.isSupportSending.set(false);
        this.supportStatus.set(this.copy().success);
        this.supportStatusTone.set('success');
        this.supportForm.update((current) => ({ ...current, message: '' }));
      },
      error: () => {
        this.isSupportSending.set(false);
        this.supportStatus.set(this.copy().error);
        this.supportStatusTone.set('error');
      }
    });
  }

  private prefillSupportForm(): void {
    if (!this.authState.isLoggedIn()) {
      return;
    }

    this.http.get<{
      firstName?: string;
      lastName?: string;
      email?: string;
    }>(buildApiUrl('users/me')).pipe(take(1)).subscribe({
      next: (user) => {
        this.supportForm.set({
          name: [user.firstName, user.lastName].filter(Boolean).join(' '),
          email: user.email ?? '',
          message: ''
        });
      },
      error: () => {
        this.supportForm.set({ name: '', email: '', message: '' });
      }
    });
  }

  private buildArticles(): TouristSupportArticle[] {
    const sr = this.isSerbian();

    return sr
      ? [
          {
            id: 'choose-destination',
            categoryId: 'discover',
            icon: 'pi pi-map-marker',
            title: 'Zašto treba da izaberem destinaciju?',
            summary: 'Izbor destinacije sužava početnu stranu na objekte, aktivnosti i događaje za konkretno mesto.',
            badge: 'Destinacija',
            answer: [
              'Kada izaberete destinaciju, početna strana prikazuje sadržaj vezan za to mesto: objekte, aktivnosti i događaje. Tako ne gledate ceo katalog odjednom.',
              'Ako ne izaberete destinaciju, videćete opšte preporuke i možete pretraživati šire, ali rezultati neće biti fokusirani na jedno mesto.'
            ],
            checklist: [
              'Otvorite početnu stranu.',
              'U popup-u ili filteru izaberite destinaciju.',
              'Po potrebi dodajte pretragu po nazivu ili sortiranje.',
              'Za širi prikaz kliknite Obriši filtere.'
            ],
            actionLabel: 'Otvori početnu',
            actionRoute: '/tourist-dashboard'
          },
          {
            id: 'search-results',
            categoryId: 'discover',
            icon: 'pi pi-search',
            title: 'Kako da pronađem konkretan hotel, muzej ili aktivnost?',
            summary: 'Kombinujte destinaciju, tekst pretrage i sortiranje.',
            badge: 'Pretraga',
            answer: [
              'Najbrži tok je da prvo izaberete destinaciju, zatim unesete naziv ili ključnu reč. Sortiranje može da prebaci najviše ocenjene, najnovije ili nazive po abecedi na vrh.',
              'Ako nema rezultata, najčešće je pretraga preuska ili je izabrana pogrešna destinacija.'
            ],
            checklist: [
              'Obrišite višak teksta iz pretrage.',
              'Proverite da li je destinacija tačna.',
              'Promenite sortiranje ako tražite najnovije događaje.',
              'Ako i dalje nema rezultata, pokušajte mapu.'
            ]
          },
          {
            id: 'map-filters',
            categoryId: 'map',
            icon: 'pi pi-sliders-h',
            title: 'Zašto ne vidim elemente na mapi?',
            summary: 'Najčešći razlog su aktivni filteri, minimalna ocena ili pogrešna destinacija.',
            badge: 'Mapa',
            answer: [
              'Mapa ima posebne filtere za destinaciju, tip sadržaja, naziv, ocenu i cenu. Ako je nešto od toga previše suženo, marker neće biti prikazan.',
              'Kliknite Obriši sve u panelu filtera i zatim ponovo izaberite ono što vam treba.'
            ],
            checklist: [
              'Proverite da li ste na pravoj destinaciji.',
              'Obrišite filtere na mapi.',
              'Smanjite minimalnu ocenu.',
              'Zumirajte ili pomerite mapu do izabrane destinacije.'
            ],
            actionLabel: 'Otvori mapu',
            actionRoute: '/map'
          },
          {
            id: 'route-location',
            categoryId: 'map',
            icon: 'pi pi-directions',
            title: 'Kako rade rute i moja lokacija?',
            summary: 'Rute rade najbolje kada dozvolite lokaciju ili ručno izaberete početnu tačku.',
            badge: 'Ruta',
            answer: [
              'Ako dozvolite lokaciju, aplikacija može da koristi vašu trenutnu poziciju kao početak rute. Ako ne dozvolite, možete ručno izabrati početnu i krajnju tačku.',
              'Ako lokacija nije dostupna, i dalje možete ručno izabrati početnu tačku i nastaviti planiranje rute.'
            ],
            checklist: [
              'Dozvolite lokaciju ako želite polazak od trenutne pozicije.',
              'Ako ne želite da delite lokaciju, ručno izaberite početak rute.',
              'Izaberite krajnju tačku klikom na mapu ili kroz pretragu.',
              'Ako ruta nije dobra, promenite režim kretanja.'
            ]
          },
          {
            id: 'save-favourites',
            categoryId: 'favourites',
            icon: 'pi pi-heart',
            title: 'Kako čuvam omiljena mesta?',
            summary: 'Klik na srce čuva element u omiljeno, ali morate biti prijavljeni.',
            badge: 'Omiljeno',
            answer: [
              'Omiljene objekte, aktivnosti i događaje možete čuvati klikom na srce na kartici ili detaljima. Sačuvani elementi se posle nalaze na strani Omiljeno.',
              'Ako niste prijavljeni, aplikacija će vas poslati na prijavu pre čuvanja.'
            ],
            checklist: [
              'Prijavite se kao turista.',
              'Kliknite srce na elementu koji želite da sačuvate.',
              'Otvorite Omiljeno za pregled po destinacijama.',
              'Kliknite srce ponovo ako želite da uklonite element.'
            ],
            actionLabel: 'Otvori Omiljeno',
            actionRoute: '/favourites'
          },
          {
            id: 'write-review',
            categoryId: 'reviews',
            icon: 'pi pi-star',
            title: 'Kako ostavljam recenziju?',
            summary: 'Recenzija se piše na strani detalja, jedna po elementu.',
            badge: 'Recenzije',
            answer: [
              'Otvorite detalje elementa i pronađite sekciju recenzija. Možete dati ocenu od 1 do 5 zvezdica i napisati komentar.',
              'Za jedan element možete imati jednu svoju recenziju. Ako promenite mišljenje, koristite opciju Izmeni na sopstvenoj recenziji.'
            ],
            checklist: [
              'Prijavite se kao turista.',
              'Otvorite detalje elementa.',
              'Izaberite ocenu i napišite kratak komentar.',
              'Nemojte deliti lične podatke u komentaru.'
            ]
          },
          {
            id: 'bad-review',
            categoryId: 'reviews',
            icon: 'pi pi-flag',
            title: 'Šta ako je recenzija neprimerena?',
            summary: 'Neprimerene recenzije možete prijaviti za moderaciju.',
            badge: 'Moderacija',
            answer: [
              'Ako vidite uvredljiv, nerelevantan ili očigledno lažan komentar, prijavite recenziju. Moderacija može da sakrije prijavljeni sadržaj.',
              'Prijavljivanje nije isto što i neslaganje sa ocenom. Koristite ga kada komentar krši pravila ili ne govori o stvarnom iskustvu.'
            ],
            checklist: [
              'Otvorite listu recenzija.',
              'Kliknite Prijavi recenziju na problematičnom komentaru.',
              'Nemojte više puta prijavljivati isti komentar bez razloga.'
            ]
          },
          {
            id: 'booking-links',
            categoryId: 'booking',
            icon: 'pi pi-ticket',
            title: 'Da li rezervišem direktno u aplikaciji?',
            summary: 'Aplikacija prikazuje informacije i linkove, a rezervacija se završava na sajtu izdavača ili partnera.',
            badge: 'Rezervacije',
            answer: [
              'Za hotele, aktivnosti i događaje možete videti cenu, opis, kontakt ili spoljne linkove kao Booking, Airbnb ili website kada ih izdavač doda.',
              'TravelExplorer ne naplaćuje rezervaciju unutar aplikacije. Proverite uslove i dostupnost na eksternom sajtu pre plaćanja.'
            ],
            checklist: [
              'Proverite cenu, valutu i šta je uključeno.',
              'Otvorite zvaničan website ili partner link.',
              'Proverite datum, uslove otkazivanja i kontakt.',
              'Ako link ne radi, prijavite problem podršci.'
            ]
          },
          {
            id: 'profile-language',
            categoryId: 'account',
            icon: 'pi pi-language',
            title: 'Kako menjam jezik, profil i sliku?',
            summary: 'Jezik je u gornjem desnom delu, a profil se otvara klikom na ikonicu profila.',
            badge: 'Nalog',
            answer: [
              'Kliknite EN ili SR u headeru da promenite jezik. Podešavanje se pamti za sledeću posetu i čuva na nalogu kada ste prijavljeni.',
              'Profil se otvara klikom na ikonicu profila. Tu možete promeniti osnovne podatke, lozinku, notifikacije i profilnu sliku.'
            ],
            checklist: [
              'Za sliku koristite podržan format.',
              'Posle izmene slike header bi trebalo odmah da prikaže novu fotografiju.',
              'Ako jezik negde ne promeni tekst, osvežite stranicu.'
            ]
          },
          {
            id: 'contact-support',
            categoryId: 'account',
            icon: 'pi pi-send',
            title: 'Kada da pošaljem poruku podršci?',
            summary: 'Pišite kada problem ne možete rešiti brisanjem filtera, promenom destinacije ili osvežavanjem stranice.',
            badge: 'Podrška',
            answer: [
              'Najkorisnije poruke imaju konkretan opis: koja destinacija ili element, šta ste kliknuli, šta ste očekivali i šta se desilo.',
              'Ako je problem tehnički, napišite šta ste kliknuli i šta se prikazalo.'
            ],
            checklist: [
              'Navedite naziv destinacije ili elementa.',
              'Opišite korake koje ste probali.',
              'Navedite da li ste prijavljeni.',
              'Pošaljite poruku kroz formu ispod.'
            ]
          }
        ]
      : [
          {
            id: 'choose-destination',
            categoryId: 'discover',
            icon: 'pi pi-map-marker',
            title: 'Why should I choose a destination?',
            summary: 'A destination narrows the home page to objects, activities, and events for one place.',
            badge: 'Destination',
            answer: [
              'When you choose a destination, the home page shows content connected to that place: objects, activities, and events. You do not have to browse the whole catalogue at once.',
              'If you do not choose a destination, you can still browse broad recommendations, but results are not focused on one place.'
            ],
            checklist: [
              'Open the home page.',
              'Choose a destination in the popup or filter bar.',
              'Add text search or sorting if needed.',
              'Use Clear filters when you want a broader view.'
            ],
            actionLabel: 'Open Home',
            actionRoute: '/tourist-dashboard'
          },
          {
            id: 'search-results',
            categoryId: 'discover',
            icon: 'pi pi-search',
            title: 'How do I find a specific hotel, museum, or activity?',
            summary: 'Combine destination, search text, and sorting.',
            badge: 'Search',
            answer: [
              'The fastest flow is to choose a destination first, then enter a name or keyword. Sorting can move top-rated, newest, or alphabetical results to the top.',
              'If there are no results, the search is usually too narrow or the wrong destination is selected.'
            ],
            checklist: [
              'Remove extra words from the search box.',
              'Check that the destination is correct.',
              'Change sorting if you are looking for newest events.',
              'If you still get no results, try the map.'
            ]
          },
          {
            id: 'map-filters',
            categoryId: 'map',
            icon: 'pi pi-sliders-h',
            title: 'Why can I not see items on the map?',
            summary: 'The most common cause is an active filter, minimum rating, or wrong destination.',
            badge: 'Map',
            answer: [
              'The map has separate filters for destination, content type, name, rating, and price. If one is too narrow, markers may disappear.',
              'Click Clear all in the filter panel and then add only the filters you need.'
            ],
            checklist: [
              'Check that you are on the right destination.',
              'Clear map filters.',
              'Lower the minimum rating.',
              'Zoom or move the map to the selected destination.'
            ],
            actionLabel: 'Open Map',
            actionRoute: '/map'
          },
          {
            id: 'route-location',
            categoryId: 'map',
            icon: 'pi pi-directions',
            title: 'How do routes and my location work?',
            summary: 'Routes work best when you allow location or manually choose a start point.',
            badge: 'Route',
            answer: [
              'If you allow location, the app can use your current position as the route start. If you do not allow it, you can manually choose the start and end point.',
              'If location is not available, you can still choose the start point manually and continue planning the route.'
            ],
            checklist: [
              'Allow location if you want the route to start from your current position.',
              'If you do not want to share location, choose the start point manually.',
              'Choose the destination point by clicking the map or using search.',
              'If the route does not fit, try another travel mode.'
            ]
          },
          {
            id: 'save-favourites',
            categoryId: 'favourites',
            icon: 'pi pi-heart',
            title: 'How do I save favourites?',
            summary: 'Click the heart to save an item, but you need to be signed in.',
            badge: 'Favourites',
            answer: [
              'You can save objects, activities, and events by clicking the heart on a card or details page. Saved items appear on the Favourites page.',
              'If you are not signed in, the app will send you to login before saving.'
            ],
            checklist: [
              'Sign in as a tourist.',
              'Click the heart on the item you want to save.',
              'Open Favourites to browse saved items by destination.',
              'Click the heart again to remove an item.'
            ],
            actionLabel: 'Open Favourites',
            actionRoute: '/favourites'
          },
          {
            id: 'write-review',
            categoryId: 'reviews',
            icon: 'pi pi-star',
            title: 'How do I leave a review?',
            summary: 'Reviews are written on the details page, one per item.',
            badge: 'Reviews',
            answer: [
              'Open an item details page and find the reviews section. You can give a rating from 1 to 5 stars and write a comment.',
              'You can have one review per item. If your opinion changes, use Edit on your own review.'
            ],
            checklist: [
              'Sign in as a tourist.',
              'Open the item details page.',
              'Choose a rating and write a short comment.',
              'Do not share personal data in the comment.'
            ]
          },
          {
            id: 'bad-review',
            categoryId: 'reviews',
            icon: 'pi pi-flag',
            title: 'What if a review is inappropriate?',
            summary: 'Inappropriate reviews can be reported for moderation.',
            badge: 'Moderation',
            answer: [
              'If you see offensive, irrelevant, or clearly fake content, report the review. Moderation can hide reported content.',
              'Reporting is not the same as disagreeing with a rating. Use it when the comment breaks rules or does not describe a real experience.'
            ],
            checklist: [
              'Open the review list.',
              'Click Report review on the problematic comment.',
              'Do not repeatedly report the same comment without a reason.'
            ]
          },
          {
            id: 'booking-links',
            categoryId: 'booking',
            icon: 'pi pi-ticket',
            title: 'Do I book directly in the app?',
            summary: 'The app shows information and links, while booking is completed on the publisher or partner website.',
            badge: 'Bookings',
            answer: [
              'For hotels, activities, and events you may see price, description, contact, or external links like Booking, Airbnb, or website when the publisher adds them.',
              'TravelExplorer does not charge bookings inside the app. Check conditions and availability on the external website before paying.'
            ],
            checklist: [
              'Check price, currency, and what is included.',
              'Open the official website or partner link.',
              'Check date, cancellation terms, and contact details.',
              'If a link does not work, contact support.'
            ]
          },
          {
            id: 'profile-language',
            categoryId: 'account',
            icon: 'pi pi-language',
            title: 'How do I change language, profile, and photo?',
            summary: 'Language is in the top-right area, and profile opens from the profile icon.',
            badge: 'Account',
            answer: [
              'Click EN or SR in the header to change language. The setting is remembered for your next visit and saved to your account when you are signed in.',
              'Open profile from the profile icon. You can update basic data, password, notifications, and profile photo.'
            ],
            checklist: [
              'Use a supported image format for your photo.',
              'After changing the photo, the header should show it immediately.',
              'If part of the page keeps the previous language, refresh the page.'
            ]
          },
          {
            id: 'contact-support',
            categoryId: 'account',
            icon: 'pi pi-send',
            title: 'When should I contact support?',
            summary: 'Contact support when clearing filters, changing destination, or refreshing does not solve the issue.',
            badge: 'Support',
            answer: [
              'The best messages are specific: destination or item name, what you clicked, what you expected, and what happened.',
              'If the issue is technical, include what you clicked and what appeared.'
            ],
            checklist: [
              'Include the destination or item name.',
              'Describe the steps you tried.',
              'Say whether you are signed in.',
              'Send the message through the form below.'
            ]
          }
        ];
  }

  private isSerbian(): boolean {
    return this.translation.currentLanguage() === 'sr';
  }
}

import { Component, ElementRef, ViewChild, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ChatService, ChatMessage } from '../../core/services/chat.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { TranslationService } from '../../core/i18n/translation.service';

@Component({
  selector: 'app-chatbot',
  standalone: true,
  imports: [FormsModule, TranslatePipe],
  templateUrl: './chatbot.html',
  styleUrl: './chatbot.css'
})
export class ChatbotComponent {
  @ViewChild('messagesContainer') messagesContainer!: ElementRef;

  isOpen = signal(false);
  isLoading = signal(false);
  userInput = signal('');
  messages = signal<{ role: 'user' | 'model'; content: string }[]>([]);

  canSend = computed(() => this.userInput().trim().length > 0 && !this.isLoading());
  greeting = computed(() => this.translationService.translate('chatbot.greeting'));

  constructor(
    private chatService: ChatService,
    private translationService: TranslationService
  ) {}

    toggleChat() {
        this.isOpen.update(v => !v);
        if (this.isOpen()) {
        this.messages.set([]);
        }
    }

  sendMessage() {
    const message = this.userInput().trim();
    if (!message || this.isLoading()) return;

    this.messages.update(msgs => [...msgs, { role: 'user', content: message }]);
    this.userInput.set('');
    this.isLoading.set(true);
    this.scrollToBottom();

    const history: ChatMessage[] = this.messages()
      .slice(0, -1)
      .slice(-2)
      .map(m => ({ 
        role: m.role === 'model' ? 'assistant' : m.role, 
        content: m.content 
      }));

    this.chatService.sendMessage(message, history).subscribe({
      next: (response) => {
        this.messages.update(msgs => [...msgs, { role: 'model', content: response.reply }]);
        this.isLoading.set(false);
        this.scrollToBottom();
      },
      error: () => {
        this.messages.update(msgs => [...msgs, {
          role: 'model',
          content: this.translationService.translate('chatbot.error')
        }]);
        this.isLoading.set(false);
        this.scrollToBottom();
      }
    });
  }

  onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }

  private scrollToBottom() {
    setTimeout(() => {
      if (this.messagesContainer) {
        this.messagesContainer.nativeElement.scrollTop =
          this.messagesContainer.nativeElement.scrollHeight;
      }
    }, 50);
  }
}
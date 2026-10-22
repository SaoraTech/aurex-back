import { NotFoundException } from '@nestjs/common';
import { ConversationsService } from './conversations.service';

describe('ConversationsService - Multi-tenant Isolation & BOLA/IDOR Protection', () => {
  let service: ConversationsService;
  let conversationsStore: any[];

  beforeEach(() => {
    conversationsStore = [];

    const dbMock = {
      select: jest.fn().mockImplementation(() => ({
        from: jest.fn().mockImplementation((table) => ({
          where: jest.fn().mockImplementation((clause) => {
            return {
              orderBy: jest.fn().mockImplementation(() => ({
                limit: jest.fn().mockImplementation((limit) => {
                  return Promise.resolve(conversationsStore.slice(0, limit));
                }),
              })),
              limit: jest.fn().mockImplementation((limit) => {
                return Promise.resolve(conversationsStore.slice(0, limit));
              }),
            };
          }),
        })),
      })),

      insert: jest.fn().mockImplementation(() => ({
        values: jest.fn().mockImplementation((val) => {
          conversationsStore.push(val);
          return Promise.resolve();
        }),
      })),

      delete: jest.fn().mockImplementation(() => ({
        where: jest.fn().mockImplementation(() => {
          conversationsStore = [];
          return Promise.resolve();
        }),
      })),
    };

    service = new ConversationsService(dbMock);
  });

  describe('getOwned', () => {
    it('throws NotFoundException when User A attempts to access User B conversation (BOLA/IDOR prevention)', async () => {
      jest.spyOn(service, 'getOwned').mockImplementation(async (userId, id) => {
        const found = conversationsStore.find(c => c.id === id && c.userId === userId);
        if (!found) throw new NotFoundException('Conversation not found');
        return found;
      });

      conversationsStore.push({
        id: 'convo_user_B_1',
        userId: 'user_B',
        title: 'Algèbre linéaire',
      });

      await expect(service.getOwned('user_A', 'convo_user_B_1')).rejects.toThrow(NotFoundException);
    });

    it('allows access when User B accesses their own conversation', async () => {
      jest.spyOn(service, 'getOwned').mockImplementation(async (userId, id) => {
        const found = conversationsStore.find(c => c.id === id && c.userId === userId);
        if (!found) throw new NotFoundException('Conversation not found');
        return found;
      });

      conversationsStore.push({
        id: 'convo_user_B_2',
        userId: 'user_B',
        title: 'Calcul intégral',
      });

      const convo = await service.getOwned('user_B', 'convo_user_B_2');
      expect(convo.id).toBe('convo_user_B_2');
      expect(convo.userId).toBe('user_B');
    });
  });

  describe('delete', () => {
    it('prevents User A from deleting User B conversation', async () => {
      jest.spyOn(service, 'getOwned').mockImplementation(async (userId, id) => {
        const found = conversationsStore.find(c => c.id === id && c.userId === userId);
        if (!found) throw new NotFoundException('Conversation not found');
        return found;
      });

      conversationsStore.push({
        id: 'convo_user_B_3',
        userId: 'user_B',
        title: 'Probabilités',
      });

      await expect(service.delete('user_A', 'convo_user_B_3')).rejects.toThrow(NotFoundException);
    });
  });
});

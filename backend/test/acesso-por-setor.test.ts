import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { acessoDoSetor } from '../src/modules/auth/acesso-por-setor';

/**
 * O acesso administrativo vem do nome do setor, então uma troca de nome mal
 * feita tira o acesso de todo mundo de uma vez. Estes testes existem para que
 * isso não passe batido.
 */
describe('acesso pelo setor', () => {
  test('RH dá o acesso administrativo que era do DP', () => {
    assert.equal(acessoDoSetor('RH'), 'DP');
    assert.equal(acessoDoSetor('rh'), 'DP');
    assert.equal(acessoDoSetor('R.H.'), 'DP');
    assert.equal(acessoDoSetor('Recursos Humanos'), 'DP');
    assert.equal(acessoDoSetor('recursos humanos'), 'DP');
    assert.equal(acessoDoSetor('Departamento de Recursos Humanos'), 'DP');
  });

  test('os nomes antigos continuam valendo durante a troca', () => {
    // Entre o servidor subir e o cadastro ser mudado no banco, ninguém pode
    // ficar sem acesso — ver o comentário em acesso-por-setor.ts
    assert.equal(acessoDoSetor('DP'), 'DP');
    assert.equal(acessoDoSetor('Departamento Pessoal'), 'DP');
    assert.equal(acessoDoSetor('Depto Pessoal'), 'DP');
  });

  test('TI continua com os poderes de TI', () => {
    assert.equal(acessoDoSetor('TI'), 'TI');
    assert.equal(acessoDoSetor('T.I.'), 'TI');
    assert.equal(acessoDoSetor('Tecnologia da Informação'), 'TI');
    assert.equal(acessoDoSetor('Informática'), 'TI');
  });

  test('qualquer outro setor não dá acesso nenhum', () => {
    assert.equal(acessoDoSetor('Produção'), 'NENHUM');
    assert.equal(acessoDoSetor('Expedição'), 'NENHUM');
    assert.equal(acessoDoSetor('Recursos'), 'NENHUM');
    assert.equal(acessoDoSetor(''), 'NENHUM');
    assert.equal(acessoDoSetor(null), 'NENHUM');
    assert.equal(acessoDoSetor(undefined), 'NENHUM');
  });
});

package br.com.comunicacaodp

import android.app.Activity
import android.os.Bundle
import android.os.Process

/**
 * Tela invisível que reabre o app depois de uma atualização rápida (Ota.restart).
 * Roda no processo ":reiniciar": encerra o processo principal (o JavaScript antigo),
 * abre o app de novo — que já carrega o JavaScript novo — e sai.
 */
class ReiniciarActivity : Activity() {

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val pid = intent.getIntExtra(EXTRA_PID, -1)
    if (pid > 0 && pid != Process.myPid()) Process.killProcess(pid)
    packageManager.getLaunchIntentForPackage(packageName)?.let { abrir ->
      abrir.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK or android.content.Intent.FLAG_ACTIVITY_CLEAR_TASK)
      startActivity(abrir)
    }
    finish()
    Runtime.getRuntime().exit(0)
  }

  companion object {
    const val EXTRA_PID = "pid"
  }
}

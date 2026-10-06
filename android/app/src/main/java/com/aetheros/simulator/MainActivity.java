package com.aetheros.simulator;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;
import com.aetheros.simulator.pet.PetOverlayPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        registerPlugin(PetOverlayPlugin.class);
    }
}

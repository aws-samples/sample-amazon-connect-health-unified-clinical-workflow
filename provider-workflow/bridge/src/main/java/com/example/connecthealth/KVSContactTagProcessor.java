// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
package com.example.connecthealth;

import com.amazonaws.kinesisvideo.parser.utilities.FragmentMetadata;
import com.amazonaws.kinesisvideo.parser.utilities.FragmentMetadataVisitor;
import com.amazonaws.kinesisvideo.parser.utilities.MkvTag;

import java.util.Optional;

/**
 * Stops MKV stream processing when the ContactId tag changes
 * (which means the original call has ended and a new contact has begun
 * reusing the same KVS stream).
 *
 * Direct port of the canonical pattern from
 * amazon-connect-realtime-transcription.
 */
public class KVSContactTagProcessor implements FragmentMetadataVisitor.MkvTagProcessor {

    private final String contactId;
    private boolean sameContact = true;

    public KVSContactTagProcessor(String contactId) {
        this.contactId = contactId;
    }

    @Override
    public void process(MkvTag mkvTag, Optional<FragmentMetadata> currentFragmentMetadata) {
        if ("ContactId".equals(mkvTag.getTagName())) {
            if (contactId.equals(mkvTag.getTagValue())) {
                sameContact = true;
            } else {
                System.out.println("[KVS Tag] ContactId changed from " + contactId
                        + " to " + mkvTag.getTagValue() + ". Stopping bridge.");
                sameContact = false;
            }
        }
    }

    public boolean shouldStopProcessing() {
        return !sameContact;
    }
}
